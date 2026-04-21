import type { Ir } from '@/lib/ir/schema'
import type { IrSummary } from './types'

export function summarizeIr(ir: Ir): IrSummary {
  const blockCounts = new Map<string, number>()
  const techStacks = new Set<string>()

  for (const block of ir.blocks) {
    if (block.container_id) {
      blockCounts.set(block.container_id, (blockCounts.get(block.container_id) ?? 0) + 1)
    }

    if (block.tech_stack) {
      techStacks.add(block.tech_stack)
    }
  }

  const summaryBase = {
    projectName: ir.project.name,
    blockCount: ir.blocks.length,
    containerCount: ir.containers.length,
    edgeCount: ir.edges.length,
    topContainers: ir.containers
      .map((container) => ({
        id: container.id,
        name: container.name,
        blockCount: blockCounts.get(container.id) ?? 0,
      }))
      .sort((a, b) => b.blockCount - a.blockCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, 5),
    techStacks: Array.from(techStacks).sort((a, b) => a.localeCompare(b)),
  }

  return {
    ...summaryBase,
    estimatedTokens: Math.ceil(JSON.stringify(summaryBase).length / 4),
  }
}
