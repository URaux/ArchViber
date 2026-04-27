import { describe, it, expect } from 'vitest'
import { computeDriftSeverity } from '../../../src/lib/drift/severity'
import type { DriftReport } from '../../../src/lib/drift/detect'
import type { IrBlock, IrContainer, IrEdge } from '../../../src/lib/ir/schema'

function block(id: string): IrBlock {
  return { id, name: id, description: '', status: 'idle', container_id: null, code_anchors: [] }
}
function container(id: string): IrContainer {
  return { id, name: id, color: 'blue' }
}
function edge(id: string): IrEdge {
  return { id, source: 'a', target: 'b', type: 'sync' }
}

function report(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    addedBlocks: [],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
    clean: false,
    ...overrides,
  }
}

describe('computeDriftSeverity', () => {
  it('clean report → score 0, level minor', () => {
    const result = computeDriftSeverity(report())
    expect(result.score).toBe(0)
    expect(result.level).toBe('minor')
    expect(result.reasons).toHaveLength(0)
  })

  it('2 removed blocks → score 10, level major', () => {
    const result = computeDriftSeverity(report({ removedBlocks: [block('b1'), block('b2')] }))
    expect(result.score).toBe(10)
    expect(result.level).toBe('major')
    expect(result.reasons.some((r) => r.includes('removed block'))).toBe(true)
  })

  it('removed container pushes score to critical threshold', () => {
    // 1 removed container = 10pts + 9 removed blocks = 45pts → total 55 → critical
    const blocks = Array.from({ length: 9 }, (_, i) => block(`b${i}`))
    const result = computeDriftSeverity(report({
      removedBlocks: blocks,
      removedContainers: [container('c1')],
    }))
    expect(result.score).toBeGreaterThan(50)
    expect(result.level).toBe('critical')
  })

  it('score is capped at 100', () => {
    // 21 removed containers = 210pts → should be capped at 100
    const containers = Array.from({ length: 21 }, (_, i) => container(`c${i}`))
    const result = computeDriftSeverity(report({ removedContainers: containers }))
    expect(result.score).toBe(100)
    expect(result.level).toBe('critical')
  })

  it('changed blocks and removed edges contribute fractional points', () => {
    const changed = [{ blockId: 'b1', before: block('b1'), after: block('b1'), changes: ['anchor'] }]
    const result = computeDriftSeverity(report({
      changedBlocks: changed,
      removedEdges: [edge('e1'), edge('e2')],
    }))
    // 1 anchor change = 1pt + 2 removed edges = 1pt → total 2, level minor
    expect(result.score).toBe(2)
    expect(result.level).toBe('minor')
    expect(result.reasons).toHaveLength(2)
  })
})
