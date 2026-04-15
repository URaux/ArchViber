import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseTsProject } from '../../../src/lib/ingest/ast-ts'

/**
 * W2.D1 smoke test — run the AST scaffold on archviber/src itself.
 *
 * PLAN.md W2.D1 verify target: "≥ 150 modules, no parse errors".
 * Current src/ has ~109 source files (tsx/ts), so we relax the floor to
 * something that genuinely exercises the parser on this codebase. If the
 * codebase grows past 150 later, tighten it back up.
 */
describe('parseTsProject — smoke on archviber/src', () => {
  const srcDir = path.resolve(__dirname, '../../../src')

  it('parses the source tree without fatal errors and returns duration', async () => {
    const result = await parseTsProject(srcDir)

    expect(result.rootDir).toBe(path.resolve(srcDir))
    expect(typeof result.durationMs).toBe('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    // No per-file parse failures — warnings array should be empty.
    expect(result.warnings).toEqual([])

    // Floor chosen from an actual pre-run on this repo (~100 files).
    // PLAN targets ≥ 150 eventually; enforce a conservative minimum that
    // still proves the parser is sweeping the tree.
    expect(result.modules.length).toBeGreaterThanOrEqual(80)
  }, 60_000)

  it('every non-entrypoint module exposes at least one export', async () => {
    const result = await parseTsProject(srcDir)

    // Conventional entrypoint-ish files that legitimately may have no exports
    // (Next.js route handlers, middleware, scripts).
    const isEntrypoint = (file: string): boolean => {
      const f = file.toLowerCase()
      return (
        /\/app\/.*\/page\.tsx?$/.test(f) ||
        /\/app\/.*\/layout\.tsx?$/.test(f) ||
        /\/app\/.*\/route\.tsx?$/.test(f) ||
        /\/middleware\.tsx?$/.test(f) ||
        /\/scripts?\//.test(f)
      )
    }

    const offenders = result.modules.filter(
      (m) => m.exports.length === 0 && !isEntrypoint(m.file)
    )

    // Allow a tiny slack — type-only ambient files, barrel placeholders, etc.
    expect(offenders.length).toBeLessThanOrEqual(5)
  }, 60_000)

  it('captures imports and symbols on a representative module', async () => {
    const result = await parseTsProject(srcDir)

    // Spot-check: find a known file with known shape.
    const storeMod = result.modules.find((m) => m.file.endsWith('/src/lib/store.ts'))
    expect(storeMod, 'src/lib/store.ts should be parsed').toBeDefined()
    if (!storeMod) return

    // store.ts imports from zustand (among others)
    expect(storeMod.imports.length).toBeGreaterThan(0)
    // And exports something
    expect(storeMod.exports.length).toBeGreaterThan(0)
  }, 60_000)
})
