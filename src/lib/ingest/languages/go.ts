/**
 * Go language adapter — W2.D3.
 *
 * Wires `tree-sitter-go.wasm` (from `tree-sitter-wasms`, no new dep) behind
 * the `LanguageAdapter` interface. Extracts:
 *   - package_clause → captured as a synthetic export (the package name)
 *   - import_spec / import_declaration → ParsedImport per imported path
 *   - type_declaration → struct/interface/alias kinds via `kind: 'class'` or 'interface'
 *   - function_declaration → 'function'
 *   - method_declaration → 'function' with attributes.receiverType
 *   - top-level var_declaration / const_declaration → 'const'
 *
 * Go convention: capitalized names are exported.
 *
 * inferTechStack scans imports for known web/ORM packages.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors python.ts)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-go.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — Go-specific receiver attribute
// ---------------------------------------------------------------------------

export interface GoParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Receiver type name (without pointer prefix) for method_declaration */
    receiverType?: string
    /** Package name from package_clause; only set on the synthetic package symbol */
    packageName?: string
  }
}

// ---------------------------------------------------------------------------
// Go AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function isExported(name: string): boolean {
  if (!name) return false
  const first = name.charAt(0)
  return first >= 'A' && first <= 'Z'
}

function unquoteImportPath(literal: string): string {
  if (literal.length >= 2 && literal.charAt(0) === '"' && literal.charAt(literal.length - 1) === '"') {
    return literal.slice(1, -1)
  }
  return literal
}

function extractImportSpec(node: TsNode): ParsedImport | null {
  // import_spec has optional `name` (alias) + required `path` (interpreted_string_literal)
  const pathNode = node.childForFieldName('path')
  if (!pathNode) return null
  const from = unquoteImportPath(pathNode.text)

  const nameNode = node.childForFieldName('name')
  const alias = nameNode?.text
  // Go's `import . "x"` (dot) and `import _ "x"` (blank) — represent as wildcard or sink
  let nameToken = '*'
  if (alias === '_') nameToken = '_'
  else if (alias === '.') nameToken = '.'
  else if (alias) nameToken = alias

  return { from, names: [nameToken] }
}

function extractReceiverType(receiverNode: TsNode): string | null {
  // receiver is a parameter_list with one parameter_declaration; type can be
  // either an identifier (T) or a pointer_type (*T).
  for (const c of receiverNode.namedChildren) {
    if (!c) continue
    if (c.type !== 'parameter_declaration') continue
    const typeNode = c.childForFieldName('type')
    if (!typeNode) continue
    if (typeNode.type === 'pointer_type') {
      // pointer_type.namedChildren[0] is the underlying type
      const inner = typeNode.namedChildren[0]
      if (inner) return inner.text
    }
    if (typeNode.type === 'type_identifier' || typeNode.type === 'identifier') {
      return typeNode.text
    }
    return typeNode.text
  }
  return null
}

interface GoBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: GoParsedSymbol[]
  packageName: string | null
}

function extractGo(root: TsNode): GoBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, GoParsedSymbol>()
  let packageName: string | null = null

  const addSymbol = (sym: GoParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string) => {
    if (isExported(name)) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'package_clause': {
        for (const c of child.namedChildren) {
          if (c && c.type === 'package_identifier') {
            packageName = c.text
            break
          }
        }
        break
      }

      case 'import_declaration': {
        // Either a single import_spec OR an import_spec_list of them
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'import_spec') {
            const spec = extractImportSpec(c)
            if (spec) imports.push(spec)
          } else if (c.type === 'import_spec_list') {
            for (const inner of c.namedChildren) {
              if (!inner || inner.type !== 'import_spec') continue
              const spec = extractImportSpec(inner)
              if (spec) imports.push(spec)
            }
          }
        }
        break
      }

      case 'type_declaration': {
        for (const c of child.namedChildren) {
          if (!c || c.type !== 'type_spec') continue
          const nameNode = c.childForFieldName('name')
          if (!nameNode) continue
          const name = nameNode.text

          // Determine kind from the body type
          const typeNode = c.childForFieldName('type')
          let kind: SymbolKind = 'type'
          if (typeNode) {
            if (typeNode.type === 'struct_type') kind = 'class'
            else if (typeNode.type === 'interface_type') kind = 'interface'
          }
          addSymbol({ name, kind })
          maybeExport(name)
        }
        break
      }

      case 'function_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'function' })
        maybeExport(nameNode.text)
        break
      }

      case 'method_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        const receiverNode = child.childForFieldName('receiver')
        const receiverType = receiverNode ? extractReceiverType(receiverNode) : null
        const sym: GoParsedSymbol = {
          name: nameNode.text,
          kind: 'function',
          ...(receiverType ? { attributes: { receiverType } } : {}),
        }
        addSymbol(sym)
        maybeExport(nameNode.text)
        break
      }

      case 'var_declaration':
      case 'const_declaration': {
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type !== 'var_spec' && c.type !== 'const_spec') continue
          const nameNode = c.childForFieldName('name')
          if (!nameNode) continue
          // var/const can declare multiple names; iterate identifier children
          for (const id of c.namedChildren) {
            if (!id || id.type !== 'identifier') continue
            addSymbol({ name: id.text, kind: 'const' })
            maybeExport(id.text)
          }
        }
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
  [/^github\.com\/gin-gonic\/gin($|\/)/, 'Go/Gin'],
  [/^github\.com\/labstack\/echo(\/v\d+)?($|\/)/, 'Go/Echo'],
  [/^github\.com\/gofiber\/fiber(\/v\d+)?($|\/)/, 'Go/Fiber'],
  [/^github\.com\/go-chi\/chi(\/v\d+)?($|\/)/, 'Go/Chi'],
  [/^github\.com\/beego\/beego(\/v\d+)?($|\/)/, 'Go/Beego'],
  [/^gorm\.io\/gorm($|\/)/, 'Go/GORM'],
  [/^google\.golang\.org\/grpc($|\/)/, 'Go/gRPC'],
  [/^net\/http$/, 'Go/net-http'],
]

function inferGoStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Go'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const goAdapter: LanguageAdapter = {
  id: 'go',
  fileExtensions: ['.go'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractGo(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'go',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferGoStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
