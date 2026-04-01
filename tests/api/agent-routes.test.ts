import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  agentRunnerMock,
  getBuildProgressMock,
  extractBuildSummaryMock,
  resolveHooksMock,
} = vi.hoisted(() => {
  const { EventEmitter } = require('events')
  const emitter = new EventEmitter()

  return {
    agentRunnerMock: Object.assign(emitter, {
      spawnAgent: vi.fn(),
      buildAll: vi.fn(),
      getStatus: vi.fn(),
    }),
    getBuildProgressMock: vi.fn(),
    extractBuildSummaryMock: vi.fn(),
    resolveHooksMock: vi.fn(),
  }
})

vi.mock('@/lib/agent-runner-instance', () => ({
  agentRunner: agentRunnerMock,
}))

vi.mock('@/lib/build-state', () => ({
  getBuildProgress: getBuildProgressMock,
}))

vi.mock('@/lib/build-summarizer', () => ({
  extractBuildSummary: extractBuildSummaryMock,
}))

vi.mock('@/lib/skill-loader', () => ({
  resolveHooks: resolveHooksMock,
}))

const [{ POST: spawnPOST }, { GET: buildStateGET }, { GET: streamGET }] = await Promise.all([
  import('@/app/api/agent/spawn/route'),
  import('@/app/api/agent/build-state/route'),
  import('@/app/api/agent/stream/route'),
])

function makeJsonRequest(url: string, body: unknown, init: RequestInit = {}) {
  return new Request(url, {
    method: init.method ?? 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function readSseEvents(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Expected an SSE response body')
  }

  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      text += decoder.decode(value, { stream: true })
    }
  }

  text += decoder.decode()

  return text
}

function parseSseData(text: string) {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (!chunk.startsWith('data: ')) {
        throw new Error(`Unexpected SSE chunk: ${chunk}`)
      }

      return JSON.parse(chunk.slice('data: '.length))
    })
}

describe('agent API routes', () => {
  beforeEach(() => {
    agentRunnerMock.removeAllListeners()
    vi.clearAllMocks()
    getBuildProgressMock.mockReset()
    extractBuildSummaryMock.mockReset()
    resolveHooksMock.mockReset()
  })

  afterEach(() => {
    agentRunnerMock.removeAllListeners()
  })

  it('forwards single-node spawn payload to agentRunner.spawnAgent', async () => {
    agentRunnerMock.spawnAgent.mockReturnValue('svc-1-123')

    const request = makeJsonRequest('https://example.test/api/agent/spawn', {
      nodeId: 'svc-1',
      prompt: 'build the API',
      backend: 'claude-code',
      workDir: '/workspaces/app',
      model: 'gpt-4.1',
    })

    const response = await spawnPOST(request)

    expect(agentRunnerMock.spawnAgent).toHaveBeenCalledWith(
      'svc-1',
      'build the API',
      'claude-code',
      '/workspaces/app',
      'gpt-4.1'
    )
    expect(await response.json()).toEqual({ agentId: 'svc-1-123' })
  })

  it('converts prompts to a Map and triggers buildAll in waves mode', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    agentRunnerMock.buildAll.mockResolvedValue(undefined)

    const request = makeJsonRequest('https://example.test/api/agent/spawn', {
      waves: [['svc-1', 'svc-2']],
      prompts: {
        'svc-1': 'first prompt',
        'svc-2': 'second prompt',
      },
      backend: 'gemini',
      workDir: '/workspaces/app',
      maxParallel: 3,
      model: 'gemini-3-flash-preview',
    })

    const response = await spawnPOST(request)

    expect(agentRunnerMock.buildAll).toHaveBeenCalledTimes(1)
    const [waves, prompts, backend, workDir, maxParallel, model] =
      agentRunnerMock.buildAll.mock.calls[0] ?? []

    expect(waves).toEqual([['svc-1', 'svc-2']])
    expect(prompts).toBeInstanceOf(Map)
    expect(Array.from((prompts as Map<string, string>).entries())).toEqual([
      ['svc-1', 'first prompt'],
      ['svc-2', 'second prompt'],
    ])
    expect(backend).toBe('gemini')
    expect(workDir).toBe('/workspaces/app')
    expect(maxParallel).toBe(3)
    expect(model).toBe('gemini-3-flash-preview')
    expect(await response.json()).toEqual({ agentId: 'build-1700000000000' })

    nowSpy.mockRestore()
  })

  it('returns the current build progress', async () => {
    const progress = {
      active: true,
      waves: [['svc-1']],
      currentWave: 0,
      nodeStatuses: { 'svc-1': 'building' as const },
      startedAt: 1234567890,
    }
    getBuildProgressMock.mockReturnValue(progress)

    const response = await buildStateGET()

    expect(getBuildProgressMock).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ progress })
  })

  it('encodes status, output, wave, and build-summary events as SSE', async () => {
    const controller = new AbortController()
    const responsePromise = streamGET(
      new Request('https://example.test/api/agent/stream', {
        signal: controller.signal,
      })
    )
    const response = await responsePromise
    const streamTextPromise = readSseEvents(response)

    agentRunnerMock.getStatus.mockReturnValue({
      agentId: 'agent-1',
      nodeId: 'svc-1',
      prompt: 'build',
      backend: 'claude-code',
      workDir: '/workspaces/app',
      status: 'running',
      output: 'generated files',
    })
    extractBuildSummaryMock.mockResolvedValue({
      builtAt: 2000,
      durationMs: 1000,
      backend: 'claude-code',
      model: 'gpt-4.1',
      filesCreated: ['src/index.ts'],
      filesModified: [],
      entryPoint: 'src/index.ts',
      dependencies: ['react'],
      techDecisions: [],
      warnings: [],
      errors: [],
      outputTokenEstimate: 12,
      truncatedOutput: undefined,
    })
    resolveHooksMock.mockReturnValue([])

    agentRunnerMock.emit('status', {
      agentId: 'agent-1',
      nodeId: 'svc-1',
      status: 'running',
    })
    agentRunnerMock.emit('output', {
      agentId: 'agent-1',
      nodeId: 'svc-1',
      text: 'hello world',
    })
    agentRunnerMock.emit('wave', { wave: 2 })
    agentRunnerMock.emit('done', {
      agentId: 'agent-1',
      nodeId: 'svc-1',
      output: 'generated files',
    })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    const text = await streamTextPromise
    const events = parseSseData(text)

    expect(events).toEqual([
      { type: 'status', nodeId: 'svc-1', status: 'building' },
      { type: 'output', nodeId: 'svc-1', text: 'hello world' },
      { type: 'wave', wave: 2 },
      {
        type: 'build-summary',
        nodeId: 'svc-1',
        summary: {
          builtAt: 2000,
          durationMs: 1000,
          backend: 'claude-code',
          model: 'gpt-4.1',
          filesCreated: ['src/index.ts'],
          filesModified: [],
          entryPoint: 'src/index.ts',
          dependencies: ['react'],
          techDecisions: [],
          warnings: [],
          errors: [],
          outputTokenEstimate: 12,
          truncatedOutput: undefined,
        },
      },
    ])
    expect(extractBuildSummaryMock).toHaveBeenCalledWith(
      '/workspaces/app',
      'generated files',
      'svc-1',
      'claude-code',
      undefined,
      expect.any(Number),
      expect.any(Number)
    )
    expect(resolveHooksMock).toHaveBeenCalledWith('build', 'node', undefined, 'post-build')
  })
})


