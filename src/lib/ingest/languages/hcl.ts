/**
 * HCL/Terraform language adapter.
 *
 * No tree-sitter-hcl.wasm is available in the bundle; uses regex-based parsing.
 * loadParser() throws a clear error if called.
 *
 * Symbol extraction from .tf / .hcl files:
 *   resource "type" "name" {}  → const  `<type>.<name>`  (e.g. aws_instance.web)
 *   variable "name" {}         → const  `var.<name>`
 *   module "name" {}           → const  `module.<name>`
 *   output "name" {}           → const  `output.<name>`
 *   locals { key = ... }       → const  `local.<key>` (top-level keys only)
 *
 * All symbols are exported.
 *
 * inferTechStack: based on resource type prefix:
 *   aws_*        → AWS/Terraform
 *   google_*     → GCP/Terraform
 *   azurerm_*    → Azure/Terraform
 *   kubernetes_* → Kubernetes/Terraform
 *   default      → Terraform
 */

import * as path from 'node:path'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol } from '../ast-ts'

export interface HclParsedSymbol extends ParsedSymbol {
  exported?: boolean
  line?: number
  blockType?: string
}

// ---------------------------------------------------------------------------
// Regex-based HCL parser
// ---------------------------------------------------------------------------

const BLOCK_RE = /^(resource|variable|module|output)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/

const LOCALS_OPEN_RE = /^locals\s*\{/
const LOCALS_KEY_RE = /^\s+([\w]+)\s*=/

export interface HclSymbolEntry {
  name: string
  line: number
  blockType: 'resource' | 'variable' | 'module' | 'output' | 'locals'
}

export function parseHcl(source: string): HclSymbolEntry[] {
  const results: HclSymbolEntry[] = []
  const seen = new Set<string>()
  const lines = source.split('\n')

  const add = (name: string, line: number, blockType: HclSymbolEntry['blockType']) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    results.push({ name, line, blockType })
  }

  let inLocals = false
  let localsDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNum = i + 1

    if (inLocals) {
      localsDepth += (raw.match(/\{/g) ?? []).length
      localsDepth -= (raw.match(/\}/g) ?? []).length
      if (localsDepth <= 0) { inLocals = false; continue }
      const km = LOCALS_KEY_RE.exec(raw)
      if (km) add(`local.${km[1]}`, lineNum, 'locals')
      continue
    }

    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    if (LOCALS_OPEN_RE.test(line)) {
      inLocals = true
      localsDepth = 1
      continue
    }

    const m = BLOCK_RE.exec(line)
    if (!m) continue
    const [, kw, arg1, arg2] = m

    switch (kw) {
      case 'resource': {
        const sym = arg2 ? `${arg1}.${arg2}` : arg1
        add(sym, lineNum, 'resource')
        break
      }
      case 'variable':
        add(`var.${arg1}`, lineNum, 'variable')
        break
      case 'module':
        add(`module.${arg1}`, lineNum, 'module')
        break
      case 'output':
        add(`output.${arg1}`, lineNum, 'output')
        break
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const PROVIDER_MAP: Array<[RegExp, string]> = [
  [/^aws_/, 'AWS/Terraform'],
  [/^google_/, 'GCP/Terraform'],
  [/^azurerm_/, 'Azure/Terraform'],
  [/^kubernetes_/, 'Kubernetes/Terraform'],
]

function inferHclStack(facts: FactInputModule[]): string {
  const providers = new Set<string>()
  for (const fact of facts) {
    for (const sym of fact.symbols) {
      const s = sym as HclParsedSymbol
      if (s.blockType === 'resource') {
        for (const [re, label] of PROVIDER_MAP) {
          if (re.test(sym.name)) { providers.add(label); break }
        }
      }
    }
  }
  if (providers.size === 0) return 'Terraform'
  return Array.from(providers).join(', ')
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const hclAdapter: LanguageAdapter = {
  id: 'hcl',
  fileExtensions: ['.tf', '.hcl'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const source = tree.rootNode.text
    const entries = parseHcl(source)

    const symbols: (HclParsedSymbol & { blockType?: string })[] = entries.map((e) => ({
      name: e.name,
      kind: 'const' as const,
      exported: true,
      line: e.line,
      blockType: e.blockType,
    }))

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports: entries.map((e) => e.name),
      symbols,
      language: 'hcl',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferHclStack(facts)
  },

  async loadParser(): Promise<Parser> {
    throw new Error(
      'tree-sitter-hcl.wasm is not available. ' +
        'HCL adapter uses regex-based extraction via parseHcl().'
    )
  },
}
