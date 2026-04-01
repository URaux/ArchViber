import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { agentRunnerMock } = vi.hoisted(() => ({
  agentRunnerMock: {
    spawnAgent: vi.fn(),
    getStatus: vi.fn(),
    stopAgent: vi.fn(),
  },
}))

vi.mock('@/lib/agent-runner-instance', () => ({
  agentRunner: agentRunnerMock,
}))

import { POST } from '@/app/api/chat/title/route'

function buildRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/chat/title', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/chat/title', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('cleans and truncates codex title output', async () => {
    const agentId = 'title-123'
    agentRunnerMock.spawnAgent.mockReturnValue(agentId)
    agentRunnerMock.getStatus.mockReturnValue({
      agentId,
      nodeId: 'title',
      prompt: '',
      backend: 'codex',
      workDir: process.cwd(),
      status: 'done',
      output: '"abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwx\nignored"',
    })

    const responsePromise = POST(
      buildRequest({
        userMessage: 'How should we name this conversation?',
        assistantMessage: 'We should keep the title compact.',
        backend: 'codex',
        model: 'codex-mini',
      })
    )

    await vi.advanceTimersByTimeAsync(150)
    const response = await responsePromise

    expect(agentRunnerMock.spawnAgent).toHaveBeenCalledWith(
      'title',
      expect.stringContaining('Generate a short title (max 20 chars) for this conversation.'),
      'codex',
      process.cwd(),
      'codex-mini'
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      title: 'abcdefghijklmnopqrst',
    })
  })
})
