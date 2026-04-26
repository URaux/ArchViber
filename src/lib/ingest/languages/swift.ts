/**
 * Swift language adapter — phase3/lang-swift.
 *
 * Wires `tree-sitter-swift.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - import_declaration → ParsedImport (module name)
 *   - class_declaration → 'class'
 *   - protocol_declaration → 'interface' (Swift protocols are interface analogues)
 *   - struct_declaration → 'class'
 *   - enum_declaration → 'class'
 *   - actor_declaration (Swift concurrency) → 'class'
 *   - top-level function_declaration → 'function'
 *   - methods inside class/struct/protocol/actor body → 'function' with attributes.parentClass
 *   - top-level property_declaration (let/var) → 'const'
 *
 * Visibility: `public` or `open` modifier → exported.
 * `private` / `fileprivate` / `internal` → NOT exported.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors rust.ts)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-swift.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — Swift parent class context
// ---------------------------------------------------------------------------

export interface SwiftParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Owning type name when this function is a method inside a class/struct/protocol/actor. */
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/** Visibility: exported if any visibility_modifier child is `public` or `open`. */
function isExported(node: TsNode): boolean {
  // tree-sitter-swift wraps modifiers in a `modifiers` named node; each
  // access control modifier is a `visibility_modifier` whose text equals
  // "public", "open", "internal", "private", or "fileprivate".
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'modifiers') {
      for (const mod of child.namedChildren) {
        if (!mod) continue
        if (mod.type === 'visibility_modifier') {
          const t = mod.text
          if (t === 'public' || t === 'open') return true
        }
      }
    }
  }
  return false
}

/** Extract the declared name from a named field or first identifier child. */
function getDeclName(node: TsNode): string | null {
  // Try field name 'name' first
  const nameNode = node.childForFieldName('name')
  if (nameNode) return nameNode.text

  // Fallback: first named child that looks like an identifier
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'simple_identifier' || c.type === 'type_identifier' || c.type === 'identifier') {
      return c.text
    }
  }
  return null
}

/** Collect method function_declarations from a declaration body. */
function extractMethods(bodyNode: TsNode, parentName: string): SwiftParsedSymbol[] {
  const methods: SwiftParsedSymbol[] = []
  for (const child of bodyNode.namedChildren) {
    if (!child) continue
    if (child.type === 'function_declaration') {
      const name = getDeclName(child)
      if (!name) continue
      methods.push({ name, kind: 'function' as SymbolKind, attributes: { parentClass: parentName } })
    }
  }
  return methods
}

/** Find the body node of a type declaration. */
function getBody(node: TsNode): TsNode | null {
  return (
    node.childForFieldName('body') ??
    node.namedChildren.find(
      (c) => c && (c.type === 'class_body' || c.type === 'protocol_body' || c.type === 'enum_body' || c.type === 'struct_body' || c.type === 'actor_body'),
    ) ??
    null
  )
}

interface SwiftBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: SwiftParsedSymbol[]
}

function extractSwift(root: TsNode): SwiftBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, SwiftParsedSymbol>()

  const addSymbol = (sym: SwiftParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string, node: TsNode) => {
    if (isExported(node)) exports.push(name)
  }

  /** Handle a type-like declaration (class/struct/enum/actor/protocol). */
  const handleTypeDecl = (child: TsNode, kind: SymbolKind) => {
    const name = getDeclName(child)
    if (!name) return
    addSymbol({ name, kind })
    maybeExport(name, child)
    const body = getBody(child)
    if (body) {
      for (const m of extractMethods(body, name)) addSymbol(m)
    }
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'import_declaration': {
        // Module path: `import SwiftUI` or `import Foundation.NSString`
        // tree-sitter-swift: the module name is in a child named 'path' or the first identifier.
        const pathNode =
          child.childForFieldName('path') ??
          child.namedChildren.find(
            (c) => c && (c.type === 'identifier' || c.type === 'simple_identifier'),
          )
        const moduleName = pathNode?.text ?? child.text.replace(/^import\s+/, '').trim()
        if (moduleName) imports.push({ from: moduleName, names: ['*'] })
        break
      }

      case 'class_declaration':
        handleTypeDecl(child, 'class')
        break

      case 'protocol_declaration':
        handleTypeDecl(child, 'interface')
        break

      case 'struct_declaration':
        handleTypeDecl(child, 'class')
        break

      case 'enum_declaration':
        handleTypeDecl(child, 'class')
        break

      case 'actor_declaration':
        handleTypeDecl(child, 'class')
        break

      case 'function_declaration': {
        const name = getDeclName(child)
        if (!name) break
        addSymbol({ name, kind: 'function' })
        maybeExport(name, child)
        break
      }

      case 'property_declaration': {
        // top-level let / var
        const name = getDeclName(child)
        if (!name) break
        addSymbol({ name, kind: 'const' })
        maybeExport(name, child)
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^SwiftUI($|\.)/, 'Swift/SwiftUI'],
  [/^UIKit($|\.)/, 'Swift/UIKit'],
  [/^Vapor($|\.)/, 'Swift/Vapor'],
  [/^Alamofire($|\.)/, 'Swift/Alamofire'],
  [/^Combine($|\.)/, 'Swift/Combine'],
]

function inferSwiftStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Swift'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const swiftAdapter: LanguageAdapter = {
  id: 'swift',
  fileExtensions: ['.swift'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractSwift(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'swift',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferSwiftStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
