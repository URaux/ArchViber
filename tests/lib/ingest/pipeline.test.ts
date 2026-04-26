/**
 * E2E pipeline tests on the vendored polyglot fixture — W2.D7.
 *
 * Runs `ingestPolyglotProject` against `tests/fixtures/polyglot/` and asserts:
 *   - all 7 fixture files (4 Python + 3 Go) are parsed via the right adapter
 *   - byLanguage breakdown matches expected counts
 *   - extracted modules carry the correct `language` tag
 *   - known framework imports are present in the resulting facts
 *   - skip-dirs honored (we don't recurse into node_modules etc.)
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { ingestPolyglotProject } from '../../../src/lib/ingest/pipeline'

const FIXTURE_ROOT = path.join(__dirname, '..', '..', 'fixtures', 'polyglot')

describe('ingestPolyglotProject (W2.D7)', () => {
  it(
    'parses all 7 fixture files with correct language adapter dispatch',
    async () => {
      const result = await ingestPolyglotProject(FIXTURE_ROOT)

      expect(result.diagnostics.filesVisited).toBe(8) // 7 source + README.md
      expect(result.diagnostics.filesParsed).toBe(7) // README skipped (no adapter)
      expect(result.diagnostics.filesSkippedNoAdapter).toBe(1)
      expect(result.diagnostics.filesFailedParse).toEqual([])

      expect(result.diagnostics.byLanguage.python).toBe(4)
      expect(result.diagnostics.byLanguage.go).toBe(3)
    },
    30_000,
  )

  it(
    'modules carry correct language tag',
    async () => {
      const result = await ingestPolyglotProject(FIXTURE_ROOT)
      const pyModules = result.modules.filter((m) => m.language === 'python')
      const goModules = result.modules.filter((m) => m.language === 'go')
      expect(pyModules).toHaveLength(4)
      expect(goModules).toHaveLength(3)

      const pyFiles = pyModules.map((m) => m.file).sort()
      expect(pyFiles).toEqual([
        'api/db.py',
        'api/main.py',
        'api/models.py',
        'api/queue.py',
      ])
    },
    30_000,
  )

  it(
    'extracts framework-signaling imports',
    async () => {
      const result = await ingestPolyglotProject(FIXTURE_ROOT)
      const allImports = result.modules.flatMap((m) => m.imports.map((i) => i.from))
      expect(allImports).toContain('fastapi')
      expect(allImports).toContain('github.com/redis/go-redis/v9')
    },
    30_000,
  )

  it('honors skipDirs', async () => {
    // node_modules doesn't exist in the fixture, but we can use the option to
    // skip 'api' and confirm only Go files come through.
    const result = await ingestPolyglotProject(FIXTURE_ROOT, {
      skipDirs: new Set(['api', 'node_modules', '.git']),
    })
    expect(result.diagnostics.byLanguage.python).toBeUndefined()
    expect(result.diagnostics.byLanguage.go).toBe(3)
  }, 30_000)
})
