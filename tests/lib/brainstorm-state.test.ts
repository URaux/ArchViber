import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  applyExternalDepsEvents,
  applyAssistantControl,
  brainstormStateFilePath,
  createInitialBrainstormState,
  formatStateForPrompt,
  parseAssistantControlComments,
  readBrainstormState,
  writeBrainstormState,
  type ExternalDepsEvent,
} from '@/lib/brainstorm/state'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-brainstorm-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeEvent(i: number): ExternalDepsEvent {
  // Mix of distinct services and a couple that overlap so compaction
  // exercises last-write-wins.
  const service = i < 20 ? `svc-${i}` : `svc-${i - 18}` // svc-2, svc-3, ... overlap
  return {
    op: 'add',
    service,
    type: 'api_key',
    status: i % 3 === 0 ? 'provided' : 'needed',
    envVar: `${service.toUpperCase().replace('-', '_')}_KEY`,
    group: i % 2 === 0 ? 'A' : 'B',
  }
}

describe('brainstorm state — externalDeps event compaction', () => {
  it('compacts the event log into a snapshot once threshold is hit', () => {
    let state = createInitialBrainstormState('s1')

    // Push 25 events one at a time so we cross the 20-event threshold.
    for (let i = 0; i < 25; i++) {
      state = applyExternalDepsEvents(state, [makeEvent(i)])
    }

    // Threshold compaction must have fired: log empties, snapshot retained.
    expect(state.externalDepsEventLog.length).toBeLessThan(20)
    expect(state.externalDeps.length).toBeGreaterThan(0)

    // Snapshot must reflect the LAST status seen for overlapping keys.
    // svc-3 was written at i=3 (i%3===0 → provided) and again at i=21
    // (21%3===0 → provided). Final remains 'provided'.
    const svc3 = state.externalDeps.find((d) => d.service === 'svc-3')
    expect(svc3?.status).toBe('provided')

    // 25 events with services svc-0..svc-19 plus svc-2..svc-6 overlap →
    // 20 unique services after de-dup.
    expect(state.externalDeps.length).toBe(20)
  })

  it('keeps the log AND a live snapshot below the compaction threshold', () => {
    let state = createInitialBrainstormState('s2')
    for (let i = 0; i < 5; i++) {
      state = applyExternalDepsEvents(state, [makeEvent(i)])
    }
    expect(state.externalDepsEventLog.length).toBe(5)
    expect(state.externalDeps.length).toBe(5)
  })

  it('treats `remove` events as deletions in the snapshot', () => {
    let state = createInitialBrainstormState('s3')
    state = applyExternalDepsEvents(state, [
      { op: 'add', service: 'stripe', type: 'api_key', status: 'needed', envVar: 'STRIPE_KEY' },
      { op: 'remove', service: 'stripe', envVar: 'STRIPE_KEY' },
    ])
    expect(state.externalDeps).toEqual([])
  })

  it('atomically writes and reads back state from disk', async () => {
    let state = createInitialBrainstormState('test-session-uuid')
    for (let i = 0; i < 22; i++) {
      state = applyExternalDepsEvents(state, [makeEvent(i)])
    }
    const written = await writeBrainstormState(tmpDir, state)
    expect(written).toBe(brainstormStateFilePath(tmpDir, 'test-session-uuid'))

    const reloaded = await readBrainstormState(tmpDir, 'test-session-uuid')
    expect(reloaded).not.toBeNull()
    expect(reloaded!.sessionId).toBe('test-session-uuid')
    expect(reloaded!.externalDeps.length).toBeGreaterThan(0)
    // 22 events: compaction fires at event 20 (log → 0), then events 21+22
    // are appended below threshold → log length = 2.
    expect(reloaded!.externalDepsEventLog.length).toBe(2)
  })

  it('returns null for an unknown sessionId', async () => {
    const result = await readBrainstormState(tmpDir, 'never-written')
    expect(result).toBeNull()
  })
})

describe('brainstorm state — assistant control parsing', () => {
  it('parses progress, externalDeps, and decisions comments out of a response', () => {
    const response = `
Some chat content here.
<!-- progress: batch=how round=3 mode=novice -->
More content.
<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","envVar":"STRIPE_SECRET_KEY","group":"A"}] -->
<!-- decisions: {"domain":"e-commerce","scale":"SMB","features":["cart","checkout"]} -->
Wrap up.
`
    const parsed = parseAssistantControlComments(response)
    expect(parsed.progress).toEqual({ batch: 'how', round: 3, mode: 'novice' })
    expect(parsed.externalDepsEvents).toHaveLength(1)
    expect(parsed.externalDepsEvents[0].service).toBe('stripe')
    expect(parsed.decisionsPatch?.domain).toBe('e-commerce')
  })

  it('tolerates malformed JSON in control comments', () => {
    const parsed = parseAssistantControlComments(
      '<!-- externalDeps: [not valid json] --> <!-- decisions: {bad} -->'
    )
    expect(parsed.externalDepsEvents).toEqual([])
    expect(parsed.decisionsPatch).toBeUndefined()
  })

  it('applies a parsed control payload to state', () => {
    let state = createInitialBrainstormState('s4')
    state = applyAssistantControl(state, {
      progress: { batch: 'deps', round: 7, mode: 'novice' },
      externalDepsEvents: [
        { op: 'add', service: 'github', type: 'oauth', status: 'needed', envVar: 'GH_OAUTH', group: 'B' },
      ],
      decisionsPatch: { domain: 'e-commerce' },
    })
    expect(state.currentBatch).toBe('deps')
    expect(state.roundCount).toBe(7)
    expect(state.decisions.domain).toBe('e-commerce')
    expect(state.externalDeps).toHaveLength(1)
  })
})

describe('brainstorm state — prompt formatting', () => {
  it('returns empty string for fresh state with no signal', () => {
    const state = createInitialBrainstormState('s5')
    expect(formatStateForPrompt(state)).toBe('')
  })

  it('renders a Chinese prefix once state has content', () => {
    let state = createInitialBrainstormState('s6')
    state = applyAssistantControl(state, {
      progress: { batch: 'how', round: 3, mode: 'novice' },
      externalDepsEvents: [
        { op: 'add', service: 'stripe', type: 'api_key', status: 'needed', envVar: 'STRIPE_KEY', group: 'A' },
      ],
      decisionsPatch: { domain: 'e-commerce', features: ['cart', 'checkout'] },
    })
    const prefix = formatStateForPrompt(state)
    expect(prefix).toContain('本次 brainstorm 已知状态')
    expect(prefix).toContain('HOW 层')
    expect(prefix).toContain('第 3 轮')
    expect(prefix).toContain('e-commerce')
    expect(prefix).toContain('stripe')
  })
})

describe('brainstorm state — sessionId sanitization', () => {
  it('rejects path traversal in sessionId', () => {
    expect(() => brainstormStateFilePath(tmpDir, '../evil')).toThrow(/Invalid sessionId/)
  })
})
