import type { BuildSummary } from './types'

export interface ProjectMemory {
  projectName: string
  updatedAt: string
  nodeSummaries: Record<string, BuildSummary> // nodeId -> BuildSummary
}
