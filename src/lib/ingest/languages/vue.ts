/**
 * Vue SFC language adapter.
 *
 * Uses `tree-sitter-vue.wasm` (present in tree-sitter-wasms/out/).
 * Pre-flight: loadParser() throws if wasm is absent.
 *
 * Extracts from <script> / <script setup> blocks:
 *   import_statement               → ParsedImport
 *   export_statement (default)     → class (component)
 *   call_expression (defineComponent) → class (component)
 *   lexical_declaration / variable_declaration at top-level → const
 *   function_declaration           → function
 *   class_declaration              → class
 *
 * Visibility:
 *   - <script setup>: all top-level declarations are treated as exported
 *   - default export: the component is always exported
 *   - other top-level: exported only if re-exported or default
 *
 * inferTechStack:
 *   nuxt imports     → 'Vue/Nuxt'
 *   vuetify imports  → 'Vue/Vuetify'
 *   default          → 'Vue'
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

function resolveVueWasm(): string {
  return path.join(resolveWasmDir(), 'tree-sitter-vue.wasm')
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  const vueWasmPath = resolveVueWasm()
  if (!existsSync(vueWasmPath)) {
    throw new Error(
      `Vue language adapter: tree-sitter-vue.wasm not found at ${vueWasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes Vue support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(vueWasmPath)
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

interface VueBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

/** Walk named imports from an import_statement node. */
function extractImportStatement(node: TsNode): ParsedImport | null {
  // (import_statement source: (string (string_fragment)))
  const sourceNode =
    node.childForFieldName('source') ??
    node.namedChildren.find((c) => c?.type === 'string') ??
    null
  if (!sourceNode) return null
  const from = sourceNode.text.replace(/^['"`]|['"`]$/g, '')
  if (!from) return null

  const names: string[] = []
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'import_clause') {
      // default import
      const defaultId = child.namedChildren.find((c) => c?.type === 'identifier')
      if (defaultId) names.push('default')
      // namespace import: * as foo
      const ns = child.namedChildren.find((c) => c?.type === 'namespace_import')
      if (ns) names.push('*')
      // named imports: { A, B }
      const named = child.namedChildren.find((c) => c?.type === 'named_imports')
      if (named) {
        for (const spec of named.namedChildren) {
          if (!spec || spec.type !== 'import_specifier') continue
          const nameNode = spec.childForFieldName('name') ?? spec.namedChildren[0]
          if (nameNode) names.push(nameNode.text)
        }
      }
    }
  }
  if (names.length === 0) names.push('*')
  return { from, names }
}

/** Determine if a call expression is defineComponent(...). */
function isDefineComponent(node: TsNode): boolean {
  const fn = node.childForFieldName('function') ?? node.namedChildren[0]
  return fn?.text === 'defineComponent'
}

/** Extract the component name from a file path (e.g. MyComp.vue → MyComp). */
function componentName(sourcePath: string): string {
  return path.basename(sourcePath, path.extname(sourcePath))
}

function extractVue(root: TsNode, sourcePath: string, isSetup: boolean): VueBundle {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, ParsedSymbol>()
  let hasDefaultExport = false

  function addSymbol(name: string, kind: SymbolKind, exported: boolean): void {
    if (!name || symbolMap.has(name)) return
    symbolMap.set(name, { name, kind, exported })
  }

  function visit(node: TsNode, depth: number): void {
    switch (node.type) {
      case 'import_statement': {
        const imp = extractImportStatement(node)
        if (imp) imports.push(imp)
        return
      }

      case 'export_statement': {
        // export default ... → component
        const defaultKw = node.namedChildren.find((c) => c?.type === 'default')
        if (defaultKw) {
          hasDefaultExport = true
          // check if it wraps defineComponent
          const body = node.namedChildren.find(
            (c) =>
              c?.type === 'call_expression' ||
              c?.type === 'object' ||
              c?.type === 'identifier',
          )
          if (body?.type === 'call_expression' && isDefineComponent(body)) {
            addSymbol(componentName(sourcePath), 'class', true)
          } else {
            addSymbol(componentName(sourcePath), 'class', true)
          }
        } else {
          // named export
          for (const child of node.namedChildren) {
            if (!child) continue
            if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
              for (const decl of child.namedChildren) {
                if (!decl || decl.type !== 'variable_declarator') continue
                const id = decl.childForFieldName('name') ?? decl.namedChildren[0]
                if (id) addSymbol(id.text, 'const', true)
              }
            } else if (child.type === 'function_declaration') {
              const id = child.childForFieldName('name') ?? child.namedChildren[0]
              if (id) addSymbol(id.text, 'function', true)
            } else if (child.type === 'class_declaration') {
              const id = child.childForFieldName('name') ?? child.namedChildren[0]
              if (id) addSymbol(id.text, 'class', true)
            }
          }
        }
        return
      }

      case 'call_expression': {
        if (depth <= 1 && isDefineComponent(node)) {
          addSymbol(componentName(sourcePath), 'class', true)
        }
        break
      }

      case 'lexical_declaration':
      case 'variable_declaration': {
        if (depth <= 1) {
          for (const decl of node.namedChildren) {
            if (!decl || decl.type !== 'variable_declarator') continue
            const id = decl.childForFieldName('name') ?? decl.namedChildren[0]
            if (id) addSymbol(id.text, 'const', isSetup)
          }
        }
        break
      }

      case 'function_declaration': {
        if (depth <= 1) {
          const id = node.childForFieldName('name') ?? node.namedChildren[0]
          if (id) addSymbol(id.text, 'function', isSetup)
        }
        break
      }

      case 'class_declaration': {
        if (depth <= 1) {
          const id = node.childForFieldName('name') ?? node.namedChildren[0]
          if (id) addSymbol(id.text, 'class', isSetup)
        }
        break
      }
    }

    for (const child of node.namedChildren) {
      if (child) visit(child, depth + 1)
    }
  }

  visit(root, 0)

  // If no explicit component symbol was found but there's a default export, add component
  if (hasDefaultExport && !symbolMap.has(componentName(sourcePath))) {
    addSymbol(componentName(sourcePath), 'class', true)
  }

  const symbols = Array.from(symbolMap.values())
  const exports = symbols.filter((s) => s.exported).map((s) => s.name)
  return { imports, exports, symbols }
}

/** Detect <script setup> by walking the SFC root for a script_element with setup attribute. */
function detectScriptSetup(root: TsNode): { scriptNode: TsNode | null; isSetup: boolean } {
  for (const child of root.namedChildren) {
    if (!child) continue
    if (child.type === 'script_element') {
      const startTag = child.namedChildren.find((c) => c?.type === 'start_tag')
      if (startTag) {
        const hasSetup = startTag.namedChildren.some(
          (c) => c?.type === 'attribute' && c.text.includes('setup'),
        )
        // The script content node (raw_text or equivalent)
        const content = child.namedChildren.find(
          (c) => c && c.type !== 'start_tag' && c.type !== 'end_tag',
        )
        return { scriptNode: content ?? child, isSetup: hasSetup }
      }
    }
  }
  return { scriptNode: null, isSetup: false }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferVueStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s.includes('nuxt'))) return 'Vue/Nuxt'
  if (allFrom.some((s) => s.includes('vuetify'))) return 'Vue/Vuetify'
  return 'Vue'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const vueAdapter: LanguageAdapter = {
  id: 'vue',
  fileExtensions: ['.vue'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const root = tree.rootNode
    const { scriptNode, isSetup } = detectScriptSetup(root)
    const { imports, exports, symbols } = scriptNode
      ? extractVue(scriptNode, sourcePath, isSetup)
      : { imports: [], exports: [], symbols: [] }

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'vue' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferVueStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
