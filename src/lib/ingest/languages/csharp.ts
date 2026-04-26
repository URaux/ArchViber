/**
 * C# language adapter — Phase 3 (6th reference impl).
 *
 * Wires `tree-sitter-c_sharp.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - namespace_declaration / file_scoped_namespace_declaration → packageName
 *   - using_directive → ParsedImport per qualified name
 *   - class_declaration → 'class'
 *   - interface_declaration → 'interface'
 *   - record_declaration (C# 9+) → 'class'
 *   - enum_declaration → 'class' (no enum kind in shared SymbolKind)
 *   - struct_declaration → 'class'
 *   - delegate_declaration → 'function' (top-level callable type)
 *   - method_declaration nested in a type body → 'function' with attributes.parentClass
 *
 * Visibility: 'public' modifier → exported. C# visibility keywords
 * ('public', 'internal', 'private', 'protected') appear as anonymous tokens
 * inside a `modifier` named child of the declaration — NOT directly on the
 * declaration's own children.
 *
 * Attributes: [Attribute]-style attribute_list nodes captured as
 * attributes.annotations (e.g. '[ApiController]').
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-c_sharp.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — C#-specific attributes
// ---------------------------------------------------------------------------

export interface CSharpParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Owning class for methods; undefined for top-level type decls. */
    parentClass?: string
    /** Attribute list text (e.g. ['[ApiController]']) when present. */
    annotations?: string[]
  }
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/**
 * C# visibility keywords ('public', 'internal', 'private', 'protected') appear
 * as anonymous tokens inside a `modifier` named child of the declaration.
 * Walk namedChildren to find the modifier node, then scan its children.
 */
function hasModifier(decl: TsNode, tokenText: string): boolean {
  for (const c of decl.namedChildren) {
    if (!c) continue
    if (c.type === 'modifier') {
      for (const mc of c.children) {
        if (mc && mc.type === tokenText) return true
      }
    }
  }
  return false
}

/**
 * Get the declaration name — in tree-sitter-c-sharp the `identifier` child
 * immediately after the keyword(s) holds the name. We find the first
 * `identifier` namedChild that is not inside an `attribute_list` or `modifier`.
 */
function getDeclName(decl: TsNode): string | null {
  for (const c of decl.namedChildren) {
    if (!c) continue
    if (c.type === 'identifier') return c.text
  }
  return null
}

/**
 * Collect C#-style attribute_list nodes from a declaration's namedChildren.
 * Returns the full bracketed text: e.g. '[ApiController]'.
 */
function collectAnnotations(decl: TsNode): string[] {
  const out: string[] = []
  for (const c of decl.namedChildren) {
    if (!c) continue
    if (c.type === 'attribute_list') out.push(c.text)
  }
  return out
}

/**
 * Find the declaration_list body child of a type declaration.
 * In tree-sitter-c-sharp the body is a `declaration_list` node.
 */
function getBody(decl: TsNode): TsNode | null {
  for (const c of decl.namedChildren) {
    if (!c) continue
    if (c.type === 'declaration_list') return c
  }
  return null
}

/**
 * Extract method_declaration nodes from a type body, tagged with parentClass.
 * Returns both the symbol and whether the method itself has a public modifier.
 */
function extractMethods(
  body: TsNode | null,
  parentClass: string,
): Array<{ sym: CSharpParsedSymbol; isPublicMethod: boolean }> {
  if (!body) return []
  const out: Array<{ sym: CSharpParsedSymbol; isPublicMethod: boolean }> = []
  for (const c of body.namedChildren) {
    if (!c) continue
    if (c.type !== 'method_declaration') continue
    const name = getDeclName(c)
    if (!name) continue
    const annotations = collectAnnotations(c)
    const sym: CSharpParsedSymbol = {
      name,
      kind: 'function' as SymbolKind,
      attributes: {
        parentClass,
        ...(annotations.length > 0 ? { annotations } : {}),
      },
    }
    out.push({ sym, isPublicMethod: hasModifier(c, 'public') })
  }
  return out
}

// ---------------------------------------------------------------------------
// Top-level extraction
// ---------------------------------------------------------------------------

interface CSharpBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: CSharpParsedSymbol[]
  packageName: string | null
}

function extractCSharp(root: TsNode): CSharpBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, CSharpParsedSymbol>()
  let packageName: string | null = null

  const addSymbol = (sym: CSharpParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  /**
   * Process a single node. May recurse into namespace / compilation_unit bodies.
   */
  function visit(node: TsNode): void {
    switch (node.type) {
      case 'using_directive': {
        // `using System.Collections.Generic;`
        // Skip alias directives (`using X = Y`) — they have a `name_equals` child.
        const hasAlias = node.namedChildren.some((c) => c && c.type === 'name_equals')
        if (hasAlias) break
        for (const c of node.namedChildren) {
          if (!c) continue
          if (c.type === 'qualified_name' || c.type === 'identifier') {
            const from = c.text.trim()
            if (!from) break
            const segs = from.split('.')
            const last = segs[segs.length - 1] ?? '*'
            imports.push({ from, names: [last] })
            break
          }
        }
        break
      }

      case 'namespace_declaration': {
        // Block-style: `namespace Foo { ... }` — body is `declaration_list`.
        if (!packageName) packageName = getDeclName(node)
        const body = getBody(node)
        if (body) {
          for (const c of body.namedChildren) {
            if (c) visit(c)
          }
        }
        break
      }

      case 'file_scoped_namespace_declaration': {
        // File-scoped: `namespace Foo;` — type decls are direct namedChildren
        // of this node (same level as the identifier).
        if (!packageName) packageName = getDeclName(node)
        for (const c of node.namedChildren) {
          if (!c) continue
          // Skip the namespace name identifier and semicolon.
          if (c.type === 'identifier') continue
          visit(c)
        }
        break
      }

      case 'class_declaration':
      case 'record_declaration':
      case 'struct_declaration':
      case 'enum_declaration': {
        const name = getDeclName(node)
        if (!name) break
        const annotations = collectAnnotations(node)
        const sym: CSharpParsedSymbol = {
          name,
          kind: 'class' as SymbolKind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        if (hasModifier(node, 'public')) exports.push(name)
        // Extract methods from body.
        const body = getBody(node)
        for (const { sym: m, isPublicMethod } of extractMethods(body, name)) {
          addSymbol(m)
          if (isPublicMethod) exports.push(m.name)
        }
        break
      }

      case 'interface_declaration': {
        const name = getDeclName(node)
        if (!name) break
        const annotations = collectAnnotations(node)
        const sym: CSharpParsedSymbol = {
          name,
          kind: 'interface' as SymbolKind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        if (hasModifier(node, 'public')) exports.push(name)
        const body = getBody(node)
        for (const { sym: m, isPublicMethod } of extractMethods(body, name)) {
          addSymbol(m)
          if (isPublicMethod) exports.push(m.name)
        }
        break
      }

      case 'delegate_declaration': {
        const name = getDeclName(node)
        if (!name) break
        const sym: CSharpParsedSymbol = { name, kind: 'function' as SymbolKind }
        addSymbol(sym)
        if (hasModifier(node, 'public')) exports.push(name)
        break
      }

      default:
        break
    }
  }

  // Walk top-level children of the compilation_unit.
  for (const child of root.namedChildren) {
    if (child) visit(child)
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
  [/Microsoft\.AspNetCore($|\.)/, 'C#/ASP.NET Core'],
  [/Microsoft\.AspNet($|\.)/, 'C#/ASP.NET'],
  [/Microsoft\.EntityFrameworkCore($|\.)/, 'C#/Entity Framework'],
  [/Microsoft\.Extensions\.Hosting($|\.)/, 'C#/.NET Generic Host'],
  [/Xamarin\.Forms($|\.)/, 'C#/Xamarin'],
  [/^Avalonia($|\.)/, 'C#/Avalonia'],
  [/MAUI|Microsoft\.Maui($|\.)/, 'C#/MAUI'],
]

function inferCSharpStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'C#'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const csharpAdapter: LanguageAdapter = {
  id: 'csharp',
  fileExtensions: ['.cs'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractCSharp(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'csharp',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferCSharpStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
