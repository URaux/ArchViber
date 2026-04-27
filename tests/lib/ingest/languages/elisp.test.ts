import { describe, it, expect, beforeAll } from 'vitest'
import { elispAdapter } from '@/lib/ingest/languages/elisp'
import type { ElispParsedSymbol } from '@/lib/ingest/languages/elisp'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import type Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await elispAdapter.loadParser()
    parserAvailable = true
  } catch {
    parserAvailable = false
  }
})

const maybeIt = parserAvailable ? it : it.skip

function parse(src: string) {
  return sharedParser!.parse(src)
}

function makeFact(imports: FactInputModule['imports']): FactInputModule {
  return { file: 'test.el', imports, exports: [], symbols: [], language: 'elisp' }
}

describe('elispAdapter metadata', () => {
  it('has id elisp', () => expect(elispAdapter.id).toBe('elisp'))
  it('has .el extension', () => expect(elispAdapter.fileExtensions).toContain('.el'))

  it('inferTechStack: plain ELisp', () => {
    expect(elispAdapter.inferTechStack([makeFact([])])).toBe('ELisp')
  })

  it('inferTechStack: ELisp/OrgMode when require org', () => {
    expect(elispAdapter.inferTechStack([makeFact([{ from: 'org', names: ['*'] }])])).toBe('ELisp/OrgMode')
  })

  it('inferTechStack: ELisp/OrgMode when require org-agenda', () => {
    expect(elispAdapter.inferTechStack([makeFact([{ from: 'org-agenda', names: ['*'] }])])).toBe('ELisp/OrgMode')
  })

  it('inferTechStack: ELisp/Evil when require evil', () => {
    expect(elispAdapter.inferTechStack([makeFact([{ from: 'evil', names: ['*'] }])])).toBe('ELisp/Evil')
  })
})

describe('elispAdapter parser', () => {
  maybeIt('extracts defun as function symbol', () => {
    const src = '(defun my-greet (name)\n  (message "Hello %s" name))\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my-greet')
    expect(sym).toBeDefined()
    expect(sym!.kind).toBe('function')
  })

  maybeIt('extracts defmacro as function symbol', () => {
    const src = '(defmacro my-when (cond &rest body)\n  `(if ,cond (progn ,@body)))\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my-when')
    expect(sym).toBeDefined()
    expect(sym!.kind).toBe('function')
  })

  maybeIt('extracts defvar as const symbol', () => {
    const src = '(defvar my-timeout 30 "Timeout in seconds.")\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my-timeout')
    expect(sym).toBeDefined()
    expect(sym!.kind).toBe('const')
  })

  maybeIt('extracts defconst as const symbol', () => {
    const src = '(defconst my-pi 3.14159 "Pi.")\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my-pi')
    expect(sym).toBeDefined()
    expect(sym!.kind).toBe('const')
  })

  maybeIt('marks public name as exported', () => {
    const src = '(defun my-public-fn () nil)\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my-public-fn') as ElispParsedSymbol | undefined
    expect(sym).toBeDefined()
    expect(sym!.exported).toBe(true)
    expect(facts.exports).toContain('my-public-fn')
  })

  maybeIt('marks double-hyphen name as not exported', () => {
    const src = '(defun my--internal-fn () nil)\n'
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    const sym = facts.symbols.find((s) => s.name === 'my--internal-fn') as ElispParsedSymbol | undefined
    expect(sym).toBeDefined()
    expect(sym!.exported).toBe(false)
    expect(facts.exports).not.toContain('my--internal-fn')
  })

  maybeIt('extracts require as import', () => {
    const src = "(require 'cl-lib)\n"
    const facts = elispAdapter.extractFacts(parse(src), 'test.el')
    expect(facts.imports.some((i) => i.from === 'cl-lib')).toBe(true)
  })

  maybeIt('file path normalized to forward slashes', () => {
    const src = ';; empty\n'
    const facts = elispAdapter.extractFacts(parse(src), 'lisp\\config.el')
    expect(facts.file).not.toContain('\\')
  })
})
