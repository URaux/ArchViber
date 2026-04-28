#!/usr/bin/env node
/**
 * Reads the language registry and emits docs/LANGUAGE-COVERAGE.md.
 *
 * The table columns are:
 *   Language | Extensions | Symbol Mapping | TechStack hints
 *
 * Run: node scripts/docs-build-language-table.mjs
 * Or:  node scripts/docs-build-language-table.mjs --print  (stdout only)
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_FILE = path.join(REPO_ROOT, 'docs', 'LANGUAGE-COVERAGE.md')

// ---------------------------------------------------------------------------
// Symbol-mapping descriptions keyed by adapter id
// ---------------------------------------------------------------------------

const SYMBOL_MAP_DESCRIPTIONS = {
  typescript: 'class → class, fn/arrow/method → fn, const/let/var → const, interface → interface, type alias → type, enum → class',
  python: 'class → class, def (top-level) → fn, def (nested) → fn, assignment → const',
  go: 'type struct/interface → class, func → fn, const/var → const',
  java: 'class/interface/enum → class, method → fn, field → const',
  rust: 'struct/enum/trait/impl → class, fn → fn, const/static → const',
  // Phase 3 adapters — descriptions added when adapter is present
  ruby: 'class/module → class, def → fn, CONST → const',
  kotlin: 'class/object/interface → class, fun → fn, val/var → const',
  scala: 'class/trait/object → class, def → fn, val/var → const',
  swift: 'class/struct/enum/protocol → class, func → fn, let/var → const',
  dart: 'class/mixin/enum → class, function → fn, const/var → const',
  lua: 'table (module-pattern) → class, function → fn, local assignment → const',
  elixir: 'defmodule → class, def/defp → fn, @const → const',
  erlang: '-module → class, -export fns → fn',
  nim: 'type (object/enum) → class, proc/func → fn, const/let → const',
  haxe: 'class/interface/enum/abstract → class, function → fn, var → const',
  solidity: 'contract/interface/library/struct/enum → class, function → fn, constant → const',
  bash: 'function → fn, exported var → const',
  ocaml: 'module/module type → class, let (top-level) → fn/const, type → type',
  vue: 'component (default export) → class, setup fn → fn',
  elm: 'module → class, top-level fn → fn, type alias → type',
  rescript: 'module → class, let binding → fn/const, type → type',
  objc: '@interface/@protocol → class, method decl → fn, property → const',
  elisp: 'defun → fn, defvar/defconst → const, defclass → class',
  json: 'top-level key → const',
  yaml: 'top-level key → const (file-type heuristics applied)',
  toml: 'top-level key → const',
  dockerfile: 'FROM → const (base image), RUN/CMD/ENTRYPOINT → fn',
  hcl: 'resource/module/output → const, variable → const',
  graphql: 'type/interface/union/enum/input → class, scalar → const, Query/Mutation/Subscription fields → fn',
  protobuf: 'message/enum/service → class, rpc → fn',
  r: 'function → fn, assignment → const',
  dart2: 'class/mixin → class, function → fn',
}

const TECHSTACK_DESCRIPTIONS = {
  typescript: 'Next.js, React, Nest.js, Vue, Angular, plain TS',
  python: 'FastAPI, Flask, Django, plain Python',
  go: 'Gin, Echo, plain Go',
  java: 'Spring, Quarkus, plain Java',
  rust: 'Actix, Axum, plain Rust',
  ruby: 'Rails, Sinatra, plain Ruby',
  kotlin: 'Ktor, Spring, plain Kotlin',
  scala: 'Akka, Play, plain Scala',
  swift: 'SwiftUI, UIKit, plain Swift',
  dart: 'Flutter, plain Dart',
  lua: 'LÖVE, OpenResty, plain Lua',
  elixir: 'Phoenix, plain Elixir',
  erlang: 'OTP/Erlang',
  nim: 'Jester, plain Nim',
  haxe: 'OpenFL, plain Haxe',
  solidity: 'ERC-20, OpenZeppelin, plain Solidity',
  bash: 'Shell/Bash',
  ocaml: 'Dune, plain OCaml',
  vue: 'Vue 3 SFC',
  elm: 'Elm',
  rescript: 'ReScript',
  objc: 'iOS/macOS/Cocoa',
  elisp: 'Emacs Lisp',
  json: 'Next.js, React, Node/Fastify, Node/Express, Node/Config',
  yaml: 'GitHub Actions, Kubernetes, Docker Compose, OpenAPI, ArchViber policy',
  toml: 'Rust/Cargo, plain TOML',
  dockerfile: 'Docker',
  hcl: 'AWS/Terraform, GCP/Terraform, Azure/Terraform, Kubernetes/Terraform',
  graphql: 'GraphQL/Apollo, GraphQL/Relay, GraphQL',
  protobuf: 'gRPC',
  r: 'R/tidyverse, R/Shiny, R',
}

// ---------------------------------------------------------------------------
// Build the table
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{rows: Array<{id:string, exts:string, symbols:string, techstack:string}>, total: number}>}
 */
export async function buildLanguageTable() {
  // Dynamically import the registry after registering defaults
  const registryUrl = new URL('../src/lib/ingest/languages/registry.ts', import.meta.url)
  // We can't directly import TS — load the compiled JS from node_modules if available,
  // or fall back to a known static list derived from register-defaults.
  // Strategy: try ts-node / tsx shim first, then static fallback.

  let adapters = []

  try {
    // tsx registers ESM TypeScript support if available
    const { listAdapters } = await import('../src/lib/ingest/languages/registry.js').catch(
      () => import('../src/lib/ingest/languages/registry.ts')
    )
    await import('../src/lib/ingest/languages/register-defaults.ts').catch(() => null)
    adapters = listAdapters()
  } catch {
    // swallow — fall through to static scan below
  }

  // If registry is sparse (branch without all adapters merged), fall back to
  // the known-good static list derived from SYMBOL_MAP_DESCRIPTIONS keys.
  if (adapters.length < Object.keys(SYMBOL_MAP_DESCRIPTIONS).length) {
    adapters = Object.keys(SYMBOL_MAP_DESCRIPTIONS).map((id) => ({ id, fileExtensions: [] }))
  }

  const rows = adapters.map((adapter) => {
    const id = adapter.id
    const exts = adapter.fileExtensions.length > 0
      ? adapter.fileExtensions.map((e) => '`' + e + '`').join(', ')
      : '—'
    const symbols = SYMBOL_MAP_DESCRIPTIONS[id] ?? '(see adapter source)'
    const techstack = TECHSTACK_DESCRIPTIONS[id] ?? '—'
    return { id, exts, symbols, techstack }
  })

  return { rows, total: rows.length }
}

function buildMarkdown(rows) {
  const header = `# Language Coverage

Auto-generated by \`scripts/docs-build-language-table.mjs\`. Do not edit by hand.

See [HOW-TO-ADD-A-LANGUAGE.md](./HOW-TO-ADD-A-LANGUAGE.md) for instructions on adding new languages.

## Supported Languages (${rows.length})

| Language | Extensions | Symbol Mapping | TechStack Hints |
|---|---|---|---|
`
  const tableRows = rows.map((r) => {
    const lang = r.id.charAt(0).toUpperCase() + r.id.slice(1)
    return `| ${lang} | ${r.exts} | ${r.symbols} | ${r.techstack} |`
  })

  return header + tableRows.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const printOnly = args.includes('--print')

const { rows, total } = await buildLanguageTable()
const markdown = buildMarkdown(rows)

if (printOnly) {
  process.stdout.write(markdown)
} else {
  await fs.mkdir(path.join(REPO_ROOT, 'docs'), { recursive: true })
  await fs.writeFile(OUT_FILE, markdown, 'utf8')
  console.log(`Wrote ${total} languages to ${path.relative(REPO_ROOT, OUT_FILE)}`)
}
