/**
 * Dart language adapter.
 *
 * Wires `tree-sitter-dart.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - library_declaration → captures library name into libraryName
 *   - import_specification → ParsedImport per imported URI
 *   - class_declaration → 'class'
 *   - mixin_declaration → 'class'
 *   - enum_declaration → 'class'
 *   - function_signature top-level → 'function'
 *   - method_signature / method_declaration inside class body → 'function' with attributes.parentClass
 *
 * Visibility: names beginning with `_` are library-private (not exported).
 * inferTechStack: flutter imports → Dart/Flutter; angular_dart → Dart/Angular; default Dart.
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-dart.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol
// ---------------------------------------------------------------------------

export interface DartParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/** Dart library-private: names starting with `_` are not exported. */
function isExported(name: string): boolean {
  return !name.startsWith('_')
}

/** Find the identifier name field child for common declaration types. */
function nameText(node: TsNode, field = 'name'): string | null {
  const n = node.childForFieldName(field)
  return n ? n.text : null
}

/** Extract methods from a class/mixin body node. */
function extractMethods(bodyNode: TsNode | null, parentClass: string): DartParsedSymbol[] {
  if (!bodyNode) return []
  const methods: DartParsedSymbol[] = []
  for (const c of bodyNode.namedChildren) {
    if (!c) continue
    // tree-sitter-dart uses method_signature for abstract/interface methods
    // and function_signature / declaration for concrete methods
    if (
      c.type === 'method_signature' ||
      c.type === 'function_signature' ||
      c.type === 'declaration'
    ) {
      const mName = nameText(c) ?? nameText(c, 'identifier')
      if (!mName) continue
      methods.push({
        name: mName,
        kind: 'function' as SymbolKind,
        attributes: { parentClass },
      })
    }
  }
  return methods
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

interface DartBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: DartParsedSymbol[]
  libraryName: string | null
}

function extractDart(root: TsNode): DartBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, DartParsedSymbol>()
  let libraryName: string | null = null

  const addSymbol = (sym: DartParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'library_name': {
        // library_name appears inside a library_declaration; also handle direct
        libraryName = child.text.replace(/^library\s+/, '').trim()
        break
      }

      case 'library_declaration': {
        // library_declaration contains a library_name child
        for (const c of child.namedChildren) {
          if (c && c.type === 'library_name') {
            // strip the leading 'library ' keyword text
            const raw = c.text
            libraryName = raw.replace(/^library\s+/, '').replace(/;$/, '').trim()
          }
        }
        break
      }

      case 'import_or_export': {
        // import_or_export wraps import_specification
        for (const c of child.namedChildren) {
          if (c && c.type === 'import_specification') {
            processImport(c, imports)
          }
        }
        break
      }

      case 'import_specification': {
        processImport(child, imports)
        break
      }

      case 'class_declaration':
      case 'mixin_declaration':
      case 'enum_declaration': {
        const n = nameText(child)
        if (!n) break
        addSymbol({ name: n, kind: 'class' as SymbolKind })
        if (isExported(n)) exports.push(n)
        const body = child.childForFieldName('body')
        for (const m of extractMethods(body, n)) {
          addSymbol(m)
          if (isExported(m.name)) exports.push(m.name)
        }
        break
      }

      case 'function_signature': {
        // Top-level function signature (abstract/external)
        const n = nameText(child)
        if (!n) break
        addSymbol({ name: n, kind: 'function' as SymbolKind })
        if (isExported(n)) exports.push(n)
        break
      }

      case 'declaration': {
        // Top-level function declaration (with body)
        const n = nameText(child) ?? nameText(child, 'identifier')
        if (!n) break
        // Only emit as function if it has a function-like shape
        // (avoid capturing variable declarations)
        const hasParams = child.children.some(
          (c) => c && (c.type === 'formal_parameter_list' || c.type === 'function_body'),
        )
        if (!hasParams) break
        addSymbol({ name: n, kind: 'function' as SymbolKind })
        if (isExported(n)) exports.push(n)
        break
      }
    }
  }

  return {
    imports,
    exports,
    symbols: Array.from(symbolMap.values()),
    libraryName,
  }
}

function processImport(node: TsNode, imports: ParsedImport[]): void {
  // import_specification: import 'package:flutter/material.dart' [as alias] [show/hide ...];
  // The URI is a string_literal child.
  let uri = ''
  const showNames: string[] = []
  let isHide = false

  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'uri') {
      // uri contains a string_literal; strip quotes
      uri = c.text.replace(/^['"]|['"]$/g, '')
    } else if (c.type === 'string_literal') {
      uri = c.text.replace(/^['"]|['"]$/g, '')
    } else if (c.type === 'combinator') {
      const keyword = c.children.find((k) => k && (k.type === 'show' || k.type === 'hide'))
      isHide = keyword?.type === 'hide'
      for (const id of c.namedChildren) {
        if (id && id.type === 'identifier') showNames.push(id.text)
      }
    }
  }

  if (!uri) return

  const names = showNames.length > 0 && !isHide ? showNames : ['*']
  imports.push({ from: uri, names })
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferDartStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s.startsWith('package:flutter/'))) return 'Dart/Flutter'
  if (allFrom.some((s) => s.startsWith('package:angular') || s.startsWith('package:angular_dart'))) {
    return 'Dart/Angular'
  }
  return 'Dart'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const dartAdapter: LanguageAdapter = {
  id: 'dart',
  fileExtensions: ['.dart'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractDart(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'dart' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferDartStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
