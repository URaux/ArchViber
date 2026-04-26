/**
 * Kotlin language adapter — phase3/lang-kotlin.
 *
 * Wires `tree-sitter-kotlin.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - package_header → captured into the synthetic packageName
 *   - import_list / import_header → ParsedImport per imported FQN
 *   - class_declaration → 'class' (includes data/sealed/abstract/open and enum prefix)
 *   - object_declaration → 'class' (Kotlin singleton)
 *   - top-level function_declaration → 'function'
 *   - function_declaration nested in class/object body → 'function' + attributes.parentClass
 *   - top-level property_declaration → 'const'
 *
 * Visibility: Kotlin default is public → exported unless modifier is
 * `private`, `internal`, or `protected` (under a `visibility_modifier` node).
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors java.ts)
// ---------------------------------------------------------------------------

function resolveWasmDir(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('tree-sitter-wasms/package.json')
    return path.join(path.dirname(pkgPath), 'out')
  } catch {
    return path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out')
  }
}

function resolveRuntimeWasm(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('web-tree-sitter/package.json')
    return path.join(path.dirname(pkgPath), 'tree-sitter.wasm')
  } catch {
    return path.join(process.cwd(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm')
  }
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser
  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-kotlin.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — Kotlin-specific receiver attribute
// ---------------------------------------------------------------------------

export interface KotlinParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Owning class/object for methods; undefined for top-level decls. */
    parentClass?: string
    /** Annotation list (e.g. ['@SpringBootApplication']) when present. */
    annotations?: string[]
  }
}

// ---------------------------------------------------------------------------
// AST extraction helpers
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/**
 * Return true if the declaration should be exported.
 * Kotlin default visibility is public — only the presence of a restricting
 * visibility_modifier makes a symbol non-exported.
 * Tree structure: modifiers > visibility_modifier > private/internal/protected
 */
function isExported(decl: TsNode): boolean {
  const modifiersNode = decl.namedChildren.find((c) => c?.type === 'modifiers')
  if (!modifiersNode) return true
  for (const c of modifiersNode.namedChildren) {
    if (!c || c.type !== 'visibility_modifier') continue
    for (const tok of c.children) {
      if (tok && (tok.type === 'private' || tok.type === 'internal' || tok.type === 'protected')) {
        return false
      }
    }
  }
  return true
}

/**
 * Collect @Annotation names from a declaration node's modifiers.
 * Tree structure: modifiers > annotation > @ + user_type > type_identifier
 */
function collectAnnotations(decl: TsNode): string[] {
  const modifiersNode = decl.namedChildren.find((c) => c?.type === 'modifiers')
  if (!modifiersNode) return []
  const out: string[] = []
  for (const c of modifiersNode.namedChildren) {
    if (!c || c.type !== 'annotation') continue
    // annotation: @ [anon] + user_type named child
    const userType = c.namedChildren.find((n) => n?.type === 'user_type')
    if (userType) {
      const typeIdent = userType.namedChildren.find((n) => n?.type === 'type_identifier')
      if (typeIdent) out.push('@' + typeIdent.text)
    }
  }
  return out
}

/** Extract method declarations from a class/object body node. */
function extractMethods(bodyNode: TsNode | null, parentClass: string): KotlinParsedSymbol[] {
  if (!bodyNode) return []
  const methods: KotlinParsedSymbol[] = []
  for (const c of bodyNode.namedChildren) {
    if (!c || c.type !== 'function_declaration') continue
    // In class bodies, function name is a simple_identifier (no field name in ts-kotlin)
    const nameNode = c.namedChildren.find((n) => n?.type === 'simple_identifier')
    if (!nameNode) continue
    const annotations = collectAnnotations(c)
    const sym: KotlinParsedSymbol = {
      name: nameNode.text,
      kind: 'function' as SymbolKind,
      attributes: {
        parentClass,
        ...(annotations.length > 0 ? { annotations } : {}),
      },
    }
    methods.push(sym)
  }
  return methods
}

/**
 * Flatten identifier node (dotted path) → string.
 * identifier nodes in tree-sitter-kotlin contain alternating simple_identifier
 * and '.' anon tokens.
 */
function identifierText(node: TsNode): string {
  if (node.type === 'simple_identifier') return node.text
  // For `identifier` (dotted): collect all simple_identifier children
  const parts = node.namedChildren
    .filter((c): c is TsNode => c !== null && c.type === 'simple_identifier')
    .map((c) => c.text)
  return parts.length > 0 ? parts.join('.') : node.text
}

interface KotlinBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: KotlinParsedSymbol[]
  packageName: string | null
}

function extractKotlin(root: TsNode): KotlinBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, KotlinParsedSymbol>()
  let packageName: string | null = null

  const addSymbol = (sym: KotlinParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'package_header': {
        // package_header: package [anon] + identifier (dotted)
        const ident = child.namedChildren.find((n) => n?.type === 'identifier' || n?.type === 'simple_identifier')
        if (ident) packageName = identifierText(ident)
        break
      }

      case 'import_list': {
        // import_list wraps one or more import_header nodes
        for (const imp of child.namedChildren) {
          if (!imp || imp.type !== 'import_header') continue
          const ident = imp.namedChildren.find((n) => n?.type === 'identifier' || n?.type === 'simple_identifier')
          if (!ident) break
          const from = identifierText(ident)
          // wildcard: import foo.* — check for '*' anon child
          const isWildcard = imp.children.some((n) => n && n.type === '*')
          const segs = from.split('.')
          const last = segs[segs.length - 1]
          imports.push({ from, names: [isWildcard ? '*' : (last ?? '*')] })
        }
        break
      }

      case 'class_declaration': {
        // Covers plain, data, sealed, abstract, open, and enum (enum has `enum` anon token before `class`)
        const nameNode = child.namedChildren.find((n) => n?.type === 'type_identifier')
        if (!nameNode) break
        const annotations = collectAnnotations(child)
        const sym: KotlinParsedSymbol = {
          name: nameNode.text,
          kind: 'class' as SymbolKind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        if (isExported(child)) exports.push(nameNode.text)

        // Extract methods from class body (class_body or enum_class_body)
        const body = child.namedChildren.find(
          (n) => n?.type === 'class_body' || n?.type === 'enum_class_body',
        )
        for (const m of extractMethods(body ?? null, nameNode.text)) {
          addSymbol(m)
        }
        break
      }

      case 'object_declaration': {
        // Singleton object
        const nameNode = child.namedChildren.find((n) => n?.type === 'type_identifier')
        if (!nameNode) break
        const annotations = collectAnnotations(child)
        const sym: KotlinParsedSymbol = {
          name: nameNode.text,
          kind: 'class' as SymbolKind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        if (isExported(child)) exports.push(nameNode.text)

        const body = child.namedChildren.find((n) => n?.type === 'class_body')
        for (const m of extractMethods(body ?? null, nameNode.text)) {
          addSymbol(m)
        }
        break
      }

      case 'function_declaration': {
        // Top-level function — name is simple_identifier
        const nameNode = child.namedChildren.find((n) => n?.type === 'simple_identifier')
        if (!nameNode) break
        const annotations = collectAnnotations(child)
        const sym: KotlinParsedSymbol = {
          name: nameNode.text,
          kind: 'function' as SymbolKind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        if (isExported(child)) exports.push(nameNode.text)
        break
      }

      case 'property_declaration': {
        // Top-level property → treat as 'const'
        // property_declaration: binding_pattern_kind (val/var) + variable_declaration > simple_identifier
        const varDecl = child.namedChildren.find((n) => n?.type === 'variable_declaration')
        const nameNode = varDecl
          ? varDecl.namedChildren.find((n) => n?.type === 'simple_identifier')
          : child.namedChildren.find((n) => n?.type === 'simple_identifier')
        if (!nameNode) break
        const sym: KotlinParsedSymbol = {
          name: nameNode.text,
          kind: 'const' as SymbolKind,
        }
        addSymbol(sym)
        if (isExported(child)) exports.push(nameNode.text)
        break
      }
    }
  }

  return {
    imports,
    exports,
    symbols: Array.from(symbolMap.values()),
    packageName,
  }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^org\.springframework\.boot($|\.)/, 'Kotlin/Spring Boot'],
  [/^io\.ktor($|\.)/, 'Kotlin/Ktor'],
  [/^spark($|\.)/, 'Kotlin/Spark Java'],
  [/^io\.vertx($|\.)/, 'Kotlin/Vert.x'],
  [/^io\.micronaut($|\.)/, 'Kotlin/Micronaut'],
  [/^android($|\.)/, 'Kotlin/Android'],
]

function inferKotlinStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Kotlin'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const kotlinAdapter: LanguageAdapter = {
  id: 'kotlin',
  fileExtensions: ['.kt', '.kts'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractKotlin(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'kotlin' as never,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferKotlinStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
