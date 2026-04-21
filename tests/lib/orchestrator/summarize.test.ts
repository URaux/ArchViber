import { describe, expect, it } from 'vitest'
import { summarizeIr } from '@/lib/orchestrator'
import type { Ir } from '@/lib/ir/schema'

function makeIr(overrides: Partial<Ir> = {}): Ir {
  return {
    version: '1.0',
    project: {
      name: 'ArchViber',
      metadata: {
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z',
        archviberVersion: '0.1.0',
      },
    },
    containers: [],
    blocks: [],
    edges: [],
    audit_log: [],
    seed_state: {},
    ...overrides,
  }
}

describe('orchestrator/summarize', () => {
  it('returns zeros for an empty IR', () => {
    expect(summarizeIr(makeIr())).toEqual({
      projectName: 'ArchViber',
      blockCount: 0,
      containerCount: 0,
      edgeCount: 0,
      topContainers: [],
      techStacks: [],
      estimatedTokens: expect.any(Number),
    })
  })

  it('dedupes duplicate tech stacks', () => {
    const summary = summarizeIr(
      makeIr({
        blocks: [
          { id: 'b1', name: 'A', description: '', status: 'idle', container_id: null, tech_stack: 'Next.js', code_anchors: [] },
          { id: 'b2', name: 'B', description: '', status: 'idle', container_id: null, tech_stack: 'Zod', code_anchors: [] },
          { id: 'b3', name: 'C', description: '', status: 'idle', container_id: null, tech_stack: 'Next.js', code_anchors: [] },
        ],
      })
    )

    expect(summary.techStacks).toEqual(['Next.js', 'Zod'])
  })

  it('sorts top containers by descending child block count', () => {
    const summary = summarizeIr(
      makeIr({
        containers: [
          { id: 'c1', name: 'API', color: 'blue' },
          { id: 'c2', name: 'Data', color: 'green' },
          { id: 'c3', name: 'UI', color: 'amber' },
        ],
        blocks: [
          { id: 'b1', name: 'A', description: '', status: 'idle', container_id: 'c2', code_anchors: [] },
          { id: 'b2', name: 'B', description: '', status: 'idle', container_id: 'c2', code_anchors: [] },
          { id: 'b3', name: 'C', description: '', status: 'idle', container_id: 'c3', code_anchors: [] },
        ],
      })
    )

    expect(summary.topContainers.map((container) => [container.id, container.blockCount])).toEqual([
      ['c2', 2],
      ['c3', 1],
      ['c1', 0],
    ])
  })

  it('limits top containers to five entries', () => {
    const containers = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index + 1}`,
      name: `Container ${index + 1}`,
      color: 'blue' as const,
    }))

    const blocks = Array.from({ length: 6 }, (_, index) => ({
      id: `b${index + 1}`,
      name: `Block ${index + 1}`,
      description: '',
      status: 'idle' as const,
      container_id: `c${index + 1}`,
      code_anchors: [],
    }))

    const summary = summarizeIr(makeIr({ containers, blocks }))
    expect(summary.topContainers).toHaveLength(5)
  })

  it('increases estimated tokens as summary size grows', () => {
    const small = summarizeIr(
      makeIr({
        containers: [{ id: 'c1', name: 'UI', color: 'blue' }],
        blocks: [{ id: 'b1', name: 'Page', description: '', status: 'idle', container_id: 'c1', tech_stack: 'React', code_anchors: [] }],
      })
    )

    const large = summarizeIr(
      makeIr({
        project: {
          name: 'ArchViber Enterprise Workspace',
          metadata: {
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            archviberVersion: '0.1.0',
          },
        },
        containers: Array.from({ length: 5 }, (_, index) => ({
          id: `c${index + 1}`,
          name: `Container ${index + 1}`,
          color: 'blue' as const,
        })),
        blocks: Array.from({ length: 10 }, (_, index) => ({
          id: `b${index + 1}`,
          name: `Block ${index + 1}`,
          description: '',
          status: 'idle' as const,
          container_id: `c${(index % 5) + 1}`,
          tech_stack: `Stack ${index + 1}`,
          code_anchors: [],
        })),
        edges: Array.from({ length: 8 }, (_, index) => ({
          id: `e${index + 1}`,
          source: 'b1',
          target: 'b2',
          type: 'sync' as const,
        })),
      })
    )

    expect(large.estimatedTokens).toBeGreaterThan(small.estimatedTokens)
  })
})
