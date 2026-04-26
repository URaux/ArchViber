/**
 * Rust language adapter — W2.D9.
 *
 * Wires `tree-sitter-rust.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - use_declaration → ParsedImport per use path
 *   - mod_item → captured as 'class' (Rust modules are roughly TS namespaces)
 *   - struct_item → 'class'
 *   - enum_item → 'class' (no enum kind in shared SymbolKind)
 *   - trait_item → 'interface' (Rust traits are interface analogues)
 *   - function_item / impl_item methods → 'function'
 *   - const_item / static_item → 'const'
 *
 * Visibility: a `visibility_modifier` child whose text starts with `pub`
 * marks the symbol as exported.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors python.ts / go.ts / java.ts)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-rust.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — Rust impl block context
// ---------------------------------------------------------------------------

export interface RustParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** When the function is inside an impl block, the type it's implemented for. */
    implFor?: string
    /** Trait name when this is a trait method or impl-of-trait method. */
    traitName?: string
  }
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function isPublic(node: TsNode): boolean {
  // visibility_modifier child whose text starts with 'pub'.
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'visibility_modifier' && c.text.startsWith('pub')) return true
  }
  return false
}

/** Walk a `use_declaration` and collect resulting imports. */
function extractUseDeclaration(node: TsNode, out: ParsedImport[]): void {
  // The simplest case: `use foo::bar::Baz;` — child is a scoped_identifier or
  // identifier. The complex case: `use foo::{a, b as bb};` — uses `use_list`
  // or `scoped_use_list` etc. We render whatever's there as raw path text and
  // do basic splits.
  const argument = node.childForFieldName('argument') ?? node.namedChildren.find((c) => c && c.type !== 'visibility_modifier')
  if (!argument) return

  // For `use a::b::C;` argument is `scoped_identifier` whose full text is the FQN.
  if (argument.type === 'scoped_identifier' || argument.type === 'identifier') {
    const fqn = argument.text
    const segs = fqn.split('::')
    const last = segs[segs.length - 1] ?? '*'
    out.push({ from: fqn, names: [last] })
    return
  }

  // For `use a::b::*;` — node text contains '*'.
  if (argument.type === 'use_wildcard') {
    // The path before ::* — argument's first child.
    const pathText = argument.namedChildren[0]?.text ?? ''
    out.push({ from: pathText, names: ['*'] })
    return
  }

  // For `use a::b::{c, d as dd};` — scoped_use_list-ish.
  if (argument.type === 'scoped_use_list' || argument.type === 'use_list') {
    // Best-effort: emit one import with the whole node text and names = ['*'].
    // This avoids missing imports while keeping logic simple.
    out.push({ from: argument.text.replace(/[{}]/g, '').trim(), names: ['*'] })
    return
  }

  // Fallback — treat the whole text as path.
  out.push({ from: argument.text, names: ['*'] })
}

function extractImplMethods(implNode: TsNode): RustParsedSymbol[] {
  const methods: RustParsedSymbol[] = []
  // impl block has a `type` field for the concrete type and optional `trait` field.
  const typeNode = implNode.childForFieldName('type')
  const traitNode = implNode.childForFieldName('trait')
  const implFor = typeNode?.text
  const traitName = traitNode?.text

  const body = implNode.childForFieldName('body')
  if (!body) return methods

  for (const c of body.namedChildren) {
    if (!c || c.type !== 'function_item') continue
    const name = c.childForFieldName('name')
    if (!name) continue
    const sym: RustParsedSymbol = {
      name: name.text,
      kind: 'function' as SymbolKind,
      attributes: {
        ...(implFor ? { implFor } : {}),
        ...(traitName ? { traitName } : {}),
      },
    }
    methods.push(sym)
  }
  return methods
}

interface RustBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: RustParsedSymbol[]
}

function extractRust(root: TsNode): RustBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, RustParsedSymbol>()

  const addSymbol = (sym: RustParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string, node: TsNode) => {
    if (isPublic(node)) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'use_declaration': {
        extractUseDeclaration(child, imports)
        break
      }

      case 'mod_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'class' })
        maybeExport(name.text, child)
        break
      }

      case 'struct_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'class' })
        maybeExport(name.text, child)
        break
      }

      case 'enum_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'class' })
        maybeExport(name.text, child)
        break
      }

      case 'trait_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'interface' })
        maybeExport(name.text, child)
        break
      }

      case 'function_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'function' })
        maybeExport(name.text, child)
        break
      }

      case 'impl_item': {
        for (const m of extractImplMethods(child)) addSymbol(m)
        // impl methods don't auto-export; we mark them based on their own visibility.
        const body = child.childForFieldName('body')
        if (body) {
          for (const c of body.namedChildren) {
            if (!c || c.type !== 'function_item') continue
            const n = c.childForFieldName('name')
            if (!n) continue
            maybeExport(n.text, c)
          }
        }
        break
      }

      case 'const_item':
      case 'static_item': {
        const name = child.childForFieldName('name')
        if (!name) break
        addSymbol({ name: name.text, kind: 'const' })
        maybeExport(name.text, child)
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
  [/^actix_web($|::)/, 'Rust/Actix Web'],
  [/^axum($|::)/, 'Rust/Axum'],
  [/^rocket($|::)/, 'Rust/Rocket'],
  [/^warp($|::)/, 'Rust/Warp'],
  [/^tide($|::)/, 'Rust/Tide'],
  [/^tonic($|::)/, 'Rust/Tonic'],
  [/^diesel($|::)/, 'Rust/Diesel'],
  [/^sqlx($|::)/, 'Rust/SQLx'],
]

function inferRustStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Rust'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const rustAdapter: LanguageAdapter = {
  id: 'rust',
  fileExtensions: ['.rs'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractRust(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'rust',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferRustStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
