import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRunner } from '@/lib/agent-runner'

type FakeProcess = {
  stdout: any
  stderr: any
  stdin: {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  kill: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => boolean
}

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('child_process', () => {
  spawnMock.mockImplementation(() => {
    const { EventEmitter } = require('events')
    const proc = new EventEmitter() as FakeProcess
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    }
    proc.kill = vi.fn()
    return proc
  })

  return {
    default: { spawn: spawnMock },
    spawn: spawnMock,
  }
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AgentRunner codex backend', () => {
  let runner: AgentRunner

  beforeEach(() => {
    spawnMock.mockClear()
    runner = new AgentRunner()
  })

  it('uses codex exec with stdin for a fresh session', () => {
    runner.spawnAgent('svc-1', 'implement backend', 'codex', '/tmp')
    const child = spawnMock.mock.results[0]?.value as FakeProcess

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['exec', '--full-auto', '--json', '-'],
      expect.objectContaining({
        cwd: '/tmp',
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
    expect(child.stdin.write).toHaveBeenCalledWith('implement backend')
    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('uses codex resume with the prompt as an argument', () => {
    runner.spawnAgent('svc-2', 'resume this task', 'codex', '/tmp', undefined, undefined, 'session-123')
    const child = spawnMock.mock.results[0]?.value as FakeProcess

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['resume', 'session-123', 'resume this task'],
      expect.objectContaining({
        cwd: '/tmp',
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
    expect(child.stdin.write).not.toHaveBeenCalled()
    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('builds codex waves in order and batches by maxParallel', async () => {
    const waveEvents: number[] = []
    runner.on('wave-start', (wave: number) => waveEvents.push(wave))

    const waves = [['a', 'b', 'c'], ['d']]
    const prompts = new Map([
      ['a', 'prompt-a'],
      ['b', 'prompt-b'],
      ['c', 'prompt-c'],
      ['d', 'prompt-d'],
    ])

    const buildPromise = runner.buildAll(waves, prompts, 'codex', '/tmp', 2)

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(waveEvents).toEqual([0])

    const first = spawnMock.mock.results[0]?.value as FakeProcess
    const second = spawnMock.mock.results[1]?.value as FakeProcess

    expect(first.stdin.write).toHaveBeenCalledWith('prompt-a')
    expect(second.stdin.write).toHaveBeenCalledWith('prompt-b')

    first.emit('close', 0)
    await tick()
    expect(spawnMock).toHaveBeenCalledTimes(2)

    second.emit('close', 0)
    await tick()
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect(waveEvents).toEqual([0])

    const third = spawnMock.mock.results[2]?.value as FakeProcess
    expect(third.stdin.write).toHaveBeenCalledWith('prompt-c')

    third.emit('close', 0)
    await tick()
    expect(spawnMock).toHaveBeenCalledTimes(4)
    expect(waveEvents).toEqual([0, 1])

    const fourth = spawnMock.mock.results[3]?.value as FakeProcess
    expect(fourth.stdin.write).toHaveBeenCalledWith('prompt-d')

    fourth.emit('close', 0)
    await buildPromise
  })

  it('marks a running codex agent as stopped when stopped', () => {
    const id = runner.spawnAgent('svc-3', 'stop me', 'codex', '/tmp')

    runner.stopAgent(id)

    expect(runner.getStatus(id)?.status).toBe('error')
    expect(runner.getStatus(id)?.errorMessage).toContain('Stopped by user')
  })
})
