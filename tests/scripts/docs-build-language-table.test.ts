import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'docs-build-language-table.mjs')

async function runScript(): Promise<string> {
  const { stdout } = await exec('node', [SCRIPT, '--print'])
  return stdout
}

describe('docs-build-language-table', () => {
  it('outputs at least 25 language rows', async () => {
    const out = await runScript()
    const rows = out.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| Language') && !l.startsWith('|---'))
    expect(rows.length).toBeGreaterThanOrEqual(25)
  })

  it('includes the supported-languages count in the header', async () => {
    const out = await runScript()
    expect(out).toMatch(/## Supported Languages \(\d+\)/)
    const match = out.match(/## Supported Languages \((\d+)\)/)
    expect(Number(match![1])).toBeGreaterThanOrEqual(25)
  })

  it('includes core adapters: TypeScript, Python, Go, Java, Rust', async () => {
    const out = await runScript()
    expect(out).toMatch(/\| Typescript /i)
    expect(out).toMatch(/\| Python /i)
    expect(out).toMatch(/\| Go /i)
    expect(out).toMatch(/\| Java /i)
    expect(out).toMatch(/\| Rust /i)
  })

  it('includes phase3 adapters: Graphql, Dockerfile, Hcl, Yaml', async () => {
    const out = await runScript()
    expect(out).toMatch(/\| Graphql /i)
    expect(out).toMatch(/\| Dockerfile /i)
    expect(out).toMatch(/\| Hcl /i)
    expect(out).toMatch(/\| Yaml /i)
  })
})
