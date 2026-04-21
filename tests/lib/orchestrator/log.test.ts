import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendClassifyLog } from '@/lib/orchestrator'

let tmpDir: string

const sampleEntry = {
  timestamp: '2026-04-21T00:00:00.000Z',
  prompt: 'summarize the architecture',
  intent: 'explain' as const,
  confidence: 0.91,
  fallback: false,
  durationMs: 24,
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-classifier-log-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('orchestrator/log', () => {
  it('creates the log file on first write', async () => {
    const logPath = path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl')

    await appendClassifyLog(sampleEntry, { path: logPath })

    const contents = await fs.readFile(logPath, 'utf8')
    expect(contents.trim()).toBe(JSON.stringify(sampleEntry))
  })

  it('appends entries without overwriting', async () => {
    const logPath = path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl')

    await appendClassifyLog(sampleEntry, { path: logPath })
    await appendClassifyLog({ ...sampleEntry, prompt: 'build this', intent: 'build' as const }, { path: logPath })

    const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"prompt":"summarize the architecture"')
    expect(lines[1]).toContain('"prompt":"build this"')
  })

  it('swallows write failures and warns instead of throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('disk full'))

    await expect(
      appendClassifyLog(sampleEntry, { path: path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl') })
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
