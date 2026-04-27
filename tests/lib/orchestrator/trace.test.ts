import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-trace-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  delete process.env.ARCHVIBER_TRACE
  delete process.env.ARCHVIBER_TRACE_FILE
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const baseTrace = {
  timestamp: '2026-04-26T00:00:00.000Z',
  intent: 'explain',
  promptHash: 'abc12345',
  classifierConfidence: 0.9,
  dispatchStatus: 'ok' as const,
  durationMs: 42,
}

describe('dispatch trace (phase3/dispatch-trace-jsonl)', () => {
  it('Test 1: write success — appends JSONL line and readRecentTraces returns it', async () => {
    const { appendDispatchTrace, readRecentTraces } = await import('@/lib/orchestrator/trace')
    const traceFile = path.join(tmpDir, 'dispatch-trace.jsonl')
    process.env.ARCHVIBER_TRACE_FILE = traceFile

    await appendDispatchTrace(baseTrace)

    const lines = (await fs.readFile(traceFile, 'utf8')).split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.intent).toBe('explain')
    expect(parsed.promptHash).toBe('abc12345')
    expect(parsed.durationMs).toBe(42)

    const traces = await readRecentTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0].dispatchStatus).toBe('ok')
  })

  it('Test 2: ARCHVIBER_TRACE=0 disables writing', async () => {
    const { appendDispatchTrace } = await import('@/lib/orchestrator/trace')
    const traceFile = path.join(tmpDir, 'dispatch-trace.jsonl')
    process.env.ARCHVIBER_TRACE_FILE = traceFile
    process.env.ARCHVIBER_TRACE = '0'

    await appendDispatchTrace(baseTrace)

    let exists = false
    try {
      await fs.access(traceFile)
      exists = true
    } catch {
      // expected
    }
    expect(exists).toBe(false)
  })

  it('Test 3: file rolls when it exceeds 5 MB', async () => {
    const { appendDispatchTrace } = await import('@/lib/orchestrator/trace')
    const traceFile = path.join(tmpDir, 'dispatch-trace.jsonl')
    process.env.ARCHVIBER_TRACE_FILE = traceFile

    // Pre-create a file exceeding 5 MB
    const fiveMbPlus = Buffer.alloc(5 * 1024 * 1024 + 1, 'x')
    await fs.mkdir(path.dirname(traceFile), { recursive: true })
    await fs.writeFile(traceFile, fiveMbPlus)

    await appendDispatchTrace(baseTrace)

    // The original file should have been renamed; the new file should contain only the new entry
    const newContent = await fs.readFile(traceFile, 'utf8')
    const lines = newContent.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).intent).toBe('explain')

    // A .bak file should exist
    const files = await fs.readdir(tmpDir)
    const baks = files.filter((f) => f.includes('.bak'))
    expect(baks.length).toBeGreaterThanOrEqual(1)
  })

  it('Test 4: readRecentTraces returns recent entries up to limit, skipping malformed lines', async () => {
    const { readRecentTraces } = await import('@/lib/orchestrator/trace')
    const traceFile = path.join(tmpDir, 'dispatch-trace.jsonl')
    process.env.ARCHVIBER_TRACE_FILE = traceFile

    const entries = [
      JSON.stringify({ ...baseTrace, intent: 'build', promptHash: 'h1' }),
      '{malformed json',
      JSON.stringify({ ...baseTrace, intent: 'explain', promptHash: 'h2' }),
      JSON.stringify({ ...baseTrace, intent: 'modify', promptHash: 'h3' }),
    ]
    await fs.mkdir(path.dirname(traceFile), { recursive: true })
    await fs.writeFile(traceFile, entries.join('\n') + '\n', 'utf8')

    const result = await readRecentTraces(2)
    expect(result).toHaveLength(2)
    expect(result[0].promptHash).toBe('h2')
    expect(result[1].promptHash).toBe('h3')
  })
})
