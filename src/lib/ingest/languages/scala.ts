/**
 * Scala language adapter — phase3/lang-scala.
 *
 * Wires `tree-sitter-scala.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - package_clause → captured into packageName
 *   - import_declaration → ParsedImport per imported FQN
 *   - class_definition → 'class'
 *   - object_definition → 'class' (Scala singleton object)
 *   - trait_definition → 'interface'
 *   - top-level function_definition → 'function'
 *   - nested function_definition → 'function' + attributes.parentClass
 *   - top-level val_definition → 'const'
 *
 * Visibility: Scala default is public → exported unless modifier is
 * `private` or `protected`.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-scala.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScalaParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

type TsNode = Parser.SyntaxNode

// ---------------------------------------------------------------------------
// Visibility helpers
// ---------------------------------------------------------------------------

function isPrivate(node: TsNode): boolean {
  // Scala tree: class_definition > modifiers > private (anon token)
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'modifiers') {
      for (const gc of c.children) {
        if (gc && (gc.type === 'private' || gc.type === 'protected')) return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

interface ScalaBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ScalaParsedSymbol[]
  packageName: string | null
}

function extractNestedFunctions(bodyNode: TsNode | null, parentClass: string): ScalaParsedSymbol[] {
  if (!bodyNode) return []
  const out: ScalaParsedSymbol[] = []
  for (const c of bodyNode.namedChildren) {
    if (!c) continue
    if (c.type === 'function_definition') {
      const name = c.childForFieldName('name')
      if (!name) continue
      out.push({ name: name.text, kind: 'function' as SymbolKind, attributes: { parentClass } })
    }
  }
  return out
}

function extractScala(root: TsNode): ScalaBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ScalaParsedSymbol>()
  let packageName: string | null = null

  const addSym = (s: ScalaParsedSymbol) => {
    if (!symbolMap.has(s.name)) symbolMap.set(s.name, s)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'package_clause': {
        // package_clause > package_identifier or qualified_identifier
        for (const c of child.namedChildren) {
          if (c && (c.type === 'package_identifier' || c.type === 'qualified_identifier' || c.type === 'identifier')) {
            packageName = c.text
            break
          }
        }
        break
      }

      case 'import_declaration': {
        // import foo.bar.Baz  or  import foo.bar.{A, B}
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'stable_identifier' || c.type === 'identifier') {
            const from = c.text
            const segs = from.split('.')
            imports.push({ from, names: [segs[segs.length - 1] ?? '*'] })
          } else if (c.type === 'import_selectors') {
            // Collect the stable_identifier sibling for the base path
            const prevSibling = c.previousNamedSibling
            const base = prevSibling ? prevSibling.text : ''
            for (const sel of c.namedChildren) {
              if (!sel) continue
              if (sel.type === 'import_selector' || sel.type === 'identifier') {
                const name = sel.childForFieldName('name') ?? sel
                imports.push({ from: base ? `${base}.${name.text}` : name.text, names: [name.text] })
              } else if (sel.type === 'wildcard') {
                imports.push({ from: base, names: ['*'] })
              }
            }
          }
        }
        break
      }

      case 'class_definition':
      case 'object_definition': {
        const name = child.childForFieldName('name')
        if (!name) break
        const sym: ScalaParsedSymbol = { name: name.text, kind: 'class' as SymbolKind }
        addSym(sym)
        if (!isPrivate(child)) exports.push(name.text)
        const body = child.childForFieldName('body') ?? child.childForFieldName('template_body')
        for (const m of extractNestedFunctions(body, name.text)) {
          addSym(m)
        }
        break
      }

      case 'trait_definition': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSym({ name: name.text, kind: 'interface' as SymbolKind })
        if (!isPrivate(child)) exports.push(name.text)
        break
      }

      case 'function_definition': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSym({ name: name.text, kind: 'function' as SymbolKind })
        if (!isPrivate(child)) exports.push(name.text)
        break
      }

      case 'val_definition': {
        // top-level val → const
        const name = child.childForFieldName('pattern')
        if (!name) break
        addSym({ name: name.text, kind: 'const' as SymbolKind })
        if (!isPrivate(child)) exports.push(name.text)
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()), packageName }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^akka($|\.)/, 'Scala/Akka'],
  [/^play($|\.)/, 'Scala/Play'],
  [/^cats($|\.)/, 'Scala/Cats'],
  [/^zio($|\.)/, 'Scala/ZIO'],
  [/^org\.apache\.spark($|\.)/, 'Scala/Spark'],
]

function inferScalaStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Scala'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const scalaAdapter: LanguageAdapter = {
  id: 'scala',
  fileExtensions: ['.scala', '.sc'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractScala(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'scala',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferScalaStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
