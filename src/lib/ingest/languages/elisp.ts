/**
 * Emacs Lisp language adapter.
 *
 * Uses `tree-sitter-elisp.wasm` (present in tree-sitter-wasms/out/).
 *
 * Extracts:
 *   defun / defmacro          → 'function' symbol
 *   defvar / defconst         → 'const' symbol
 *   (require 'pkg)            → ParsedImport
 *   (provide 'pkg)            → recorded as package name / export
 *
 * Visibility: ELisp convention — names containing '--' are internal
 * (package-private). All other names are exported.
 *
 * inferTechStack:
 *   require of org → ELisp/OrgMode
 *   require of evil → ELisp/Evil
 *   default → ELisp
 */

import * as path from 'node:path'
import { existsSync } from 'node:fs'
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-elisp.wasm')
  if (!existsSync(wasmPath)) {
    throw new Error(
      `ELisp adapter: tree-sitter-elisp.wasm not found at ${wasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes ELisp support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

export interface ElispParsedSymbol extends ParsedSymbol {
  /** False when the name contains '--' (ELisp internal convention). */
  exported: boolean
}

/** Names containing '--' are package-internal by ELisp convention. */
function isExported(name: string): boolean {
  return !name.includes('--')
}

/**
 * tree-sitter-elisp represents ELisp as a sequence of list nodes.
 * A `(defun name args body)` surfaces as:
 *   (list (symbol "defun") (symbol "name") ...)
 *
 * We walk top-level list nodes and inspect the first symbol child.
 */
function extractElisp(root: TsNode): {
  imports: ParsedImport[]
  exports: string[]
  symbols: ElispParsedSymbol[]
} {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, ElispParsedSymbol>()

  for (const node of root.namedChildren) {
    if (!node || node.type !== 'list') continue

    const children = node.namedChildren.filter(Boolean) as TsNode[]
    if (children.length === 0) continue

    const head = children[0]
    if (!head || head.type !== 'symbol') continue

    const form = head.text

    switch (form) {
      case 'defun':
      case 'defmacro': {
        const nameNode = children[1]
        if (!nameNode) break
        const name = nameNode.text
        if (!name) break
        if (!symbolMap.has(name)) {
          symbolMap.set(name, {
            name,
            kind: 'function' as SymbolKind,
            exported: isExported(name),
          })
        }
        break
      }

      case 'defvar':
      case 'defconst': {
        const nameNode = children[1]
        if (!nameNode) break
        const name = nameNode.text
        if (!name) break
        if (!symbolMap.has(name)) {
          symbolMap.set(name, {
            name,
            kind: 'const' as SymbolKind,
            exported: isExported(name),
          })
        }
        break
      }

      case 'require': {
        // (require 'pkg) — second child is a quoted_symbol: (quote (symbol "pkg"))
        const quotedNode = children[1]
        if (!quotedNode) break
        let pkgName: string | null = null
        if (quotedNode.type === 'quoted_symbol') {
          // tree-sitter-elisp: quoted_symbol → text like "'pkg"
          pkgName = quotedNode.text.replace(/^'/, '')
        } else if (quotedNode.type === 'quote') {
          // Alternative: (quote (symbol "pkg"))
          const sym = quotedNode.namedChildren.find((c) => c && c.type === 'symbol')
          pkgName = sym?.text ?? null
        } else if (quotedNode.type === 'symbol') {
          pkgName = quotedNode.text
        }
        if (pkgName) imports.push({ from: pkgName, names: ['*'] })
        break
      }

      case 'provide': {
        // (provide 'pkg) — emit as a wildcard self-export marker
        const quotedNode = children[1]
        if (!quotedNode) break
        let pkgName: string | null = null
        if (quotedNode.type === 'quoted_symbol') {
          pkgName = quotedNode.text.replace(/^'/, '')
        } else if (quotedNode.type === 'symbol') {
          pkgName = quotedNode.text
        }
        if (pkgName) {
          // Record as a self-export so callers can detect the package name.
          imports.push({ from: `provide:${pkgName}`, names: ['*'] })
        }
        break
      }
    }
  }

  const symbols = Array.from(symbolMap.values())
  const exports = symbols.filter((s) => s.exported).map((s) => s.name)
  return { imports, exports, symbols }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferElispStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s === 'org' || s.startsWith('org-'))) return 'ELisp/OrgMode'
  if (allFrom.some((s) => s === 'evil' || s.startsWith('evil-'))) return 'ELisp/Evil'
  return 'ELisp'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const elispAdapter: LanguageAdapter = {
  id: 'elisp',
  fileExtensions: ['.el'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractElisp(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'elisp' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferElispStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
