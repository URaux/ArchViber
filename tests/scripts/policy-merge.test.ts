/**
 * Tests for scripts/policy-merge.mjs — phase3/policy-merge-cli
 * Spawns the real script with fixture policy YAML files.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'policy-merge.mjs')

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-policy-merge-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writePolicy(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

async function runMerge(inputs: string[], outName: string): Promise<{ stdout: string; stderr: string; outPath: string }> {
  const outPath = path.join(tmpDir, outName)
  const args = [...inputs.flatMap((i) => ['--in', i]), '--out', outPath]
  const { stdout, stderr } = await exec('node', [SCRIPT, ...args])
  return { stdout, stderr, outPath }
}

describe('policy-merge.mjs', () => {
  it('Test 1: numeric thresholds — MIN wins', async () => {
    const a = await writePolicy('numeric-a.yaml', `
drift:
  maxAddedBlocks: 10
  maxRemovedBlocks: 5
  maxChangedBlocks: 8
`)
    const b = await writePolicy('numeric-b.yaml', `
drift:
  maxAddedBlocks: 3
  maxRemovedBlocks: 7
  maxChangedBlocks: 2
`)
    const { outPath } = await runMerge([a, b], 'numeric-out.yaml')
    const merged = parseYaml(await fs.readFile(outPath, 'utf8'))
    expect(merged.drift.maxAddedBlocks).toBe(3)    // min(10,3)
    expect(merged.drift.maxRemovedBlocks).toBe(5)   // min(5,7)
    expect(merged.drift.maxChangedBlocks).toBe(2)   // min(8,2)
  })

  it('Test 2: boolean flags — OR (any true wins)', async () => {
    const a = await writePolicy('bool-a.yaml', `
drift:
  failOnRemoved: true
  failOnAdded: false
  failOnChanged: false
`)
    const b = await writePolicy('bool-b.yaml', `
drift:
  failOnRemoved: false
  failOnAdded: true
  failOnChanged: false
`)
    const { outPath } = await runMerge([a, b], 'bool-out.yaml')
    const merged = parseYaml(await fs.readFile(outPath, 'utf8'))
    expect(merged.drift.failOnRemoved).toBe(true)   // true OR false
    expect(merged.drift.failOnAdded).toBe(true)     // false OR true
    expect(merged.drift.failOnChanged).toBe(false)  // false OR false
  })

  it('Test 3: ignore lists — UNION (concat + dedup)', async () => {
    const a = await writePolicy('list-a.yaml', `
drift:
  ignoreBlockIds:
    - block-1
    - block-2
  ignoreContainerIds:
    - container-A
  ignoreEdgeIds: []
`)
    const b = await writePolicy('list-b.yaml', `
drift:
  ignoreBlockIds:
    - block-2
    - block-3
  ignoreContainerIds:
    - container-B
  ignoreEdgeIds:
    - edge-X
`)
    const { outPath } = await runMerge([a, b], 'list-out.yaml')
    const merged = parseYaml(await fs.readFile(outPath, 'utf8'))
    expect(merged.drift.ignoreBlockIds).toEqual(['block-1', 'block-2', 'block-3'])
    expect(merged.drift.ignoreContainerIds).toEqual(['container-A', 'container-B'])
    expect(merged.drift.ignoreEdgeIds).toEqual(['edge-X'])
  })

  it('Test 4: schema rejection on bad input — exits 1 with error message', async () => {
    const bad = await writePolicy('bad-input.yaml', `
drift:
  unknownField: 42
  maxAddedBlocks: -5
`)
    const good = await writePolicy('good-for-bad-test.yaml', `
drift:
  failOnRemoved: false
`)
    const outPath = path.join(tmpDir, 'bad-out.yaml')
    const args = ['--in', bad, '--in', good, '--out', outPath]
    let threw = false
    let stderr = ''
    try {
      await exec('node', [SCRIPT, ...args])
    } catch (err) {
      threw = true
      stderr = (err as { stderr?: string }).stderr ?? ''
    }
    expect(threw).toBe(true)
    expect(stderr).toMatch(/schema validation failed|validation failed/i)
  })
})
