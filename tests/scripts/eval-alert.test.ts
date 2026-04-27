import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'eval-alert.mjs')

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-alert-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function snapshot(accuracy: number, filename: string): object {
  return {
    generatedAt: new Date().toISOString(),
    classifier: { totalCount: 10, passCount: Math.round(accuracy * 10), accuracy },
    dispatch: { totalCount: 0, okCount: 0, notImplementedCount: 0, errorCount: 0, explainShapeFails: 0 },
    fixtures: [],
  }
}

async function writeSnapshot(dir: string, filename: string, accuracy: number) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), JSON.stringify(snapshot(accuracy), null, 2))
}

async function runScript(args: string[]) {
  return exec(process.execPath, [SCRIPT, ...args], { cwd: tmpDir })
}

describe('eval-alert.mjs', () => {
  it('Test 1: accuracy above threshold → exit 0, no alert file', async () => {
    const histDir = path.join(tmpDir, 'hist')
    const outFile = path.join(tmpDir, 'alert.md')
    await writeSnapshot(histDir, '001.json', 0.90)

    const { stdout } = await runScript(['--dir', histDir, '--threshold', '0.85', '--out', outFile])
    expect(stdout).toContain('OK')
    await expect(fs.access(outFile)).rejects.toThrow()
  })

  it('Test 2: accuracy below threshold → exit 1, alert.md written with BELOW THRESHOLD', async () => {
    const histDir = path.join(tmpDir, 'hist')
    const outFile = path.join(tmpDir, 'alert.md')
    await writeSnapshot(histDir, '001.json', 0.80)

    await expect(runScript(['--dir', histDir, '--threshold', '0.85', '--out', outFile])).rejects.toMatchObject({ code: 1 })
    const content = await fs.readFile(outFile, 'utf8')
    expect(content).toContain('BELOW THRESHOLD')
    expect(content).toContain('80.0%')
  })

  it('Test 3: sudden drop > 5pp from previous run → exit 1, alert.md written with SUDDEN DROP', async () => {
    const histDir = path.join(tmpDir, 'hist')
    const outFile = path.join(tmpDir, 'alert.md')
    await writeSnapshot(histDir, '001.json', 0.92)
    await writeSnapshot(histDir, '002.json', 0.86) // drop = 6pp > 5pp

    await expect(runScript(['--dir', histDir, '--threshold', '0.85', '--out', outFile])).rejects.toMatchObject({ code: 1 })
    const content = await fs.readFile(outFile, 'utf8')
    expect(content).toContain('SUDDEN DROP')
  })

  it('Test 4: empty dir → exit 0, no alert file', async () => {
    const histDir = path.join(tmpDir, 'hist')
    const outFile = path.join(tmpDir, 'alert.md')
    await fs.mkdir(histDir)

    const { stdout } = await runScript(['--dir', histDir, '--threshold', '0.85', '--out', outFile])
    expect(stdout).toContain('No eval snapshots found')
    await expect(fs.access(outFile)).rejects.toThrow()
  })
})
