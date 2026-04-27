import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-export-csv.mjs')

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-csv-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeJson(name: string, data: unknown): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, JSON.stringify(data), 'utf8')
  return p
}

describe('scripts/drift-export-csv.mjs', () => {
  it('empty drift emits header only', async () => {
    const inputPath = await writeJson('empty.json', {
      addedBlocks: [],
      removedBlocks: [],
      changedBlocks: [],
      addedContainers: [],
      removedContainers: [],
      addedEdges: [],
      removedEdges: [],
      clean: true,
    })
    const { stdout } = await exec('node', [SCRIPT, '--input', inputPath], { cwd: REPO_ROOT })
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('kind,id,name,change')
  }, 30_000)

  it('populated drift emits correct rows', async () => {
    const inputPath = await writeJson('populated.json', {
      addedBlocks: [{ id: 'b1', name: 'AuthService' }],
      removedBlocks: [{ id: 'b2', name: 'OldAuth' }],
      changedBlocks: [{ id: 'b3', name: 'PayService' }],
      addedContainers: [],
      removedContainers: [],
      addedEdges: [],
      removedEdges: [],
      clean: false,
    })
    const { stdout } = await exec('node', [SCRIPT, '--input', inputPath], { cwd: REPO_ROOT })
    expect(stdout).toContain('block,b1,AuthService,added')
    expect(stdout).toContain('block,b2,OldAuth,removed')
    expect(stdout).toContain('block,b3,PayService,changed')
  }, 30_000)

  it('special chars in names are escaped with quotes', async () => {
    const inputPath = await writeJson('special.json', {
      addedBlocks: [{ id: 'b1', name: 'Service, "Alpha"' }],
      removedBlocks: [],
      changedBlocks: [],
      addedContainers: [],
      removedContainers: [],
      addedEdges: [],
      removedEdges: [],
      clean: false,
    })
    const { stdout } = await exec('node', [SCRIPT, '--input', inputPath], { cwd: REPO_ROOT })
    // name with comma and quotes must be CSV-escaped
    expect(stdout).toContain('"Service, ""Alpha"""')
  }, 30_000)
})
