export const INTENTS = ['design_edit', 'build', 'modify', 'deep_analyze', 'explain'] as const

export type Intent = (typeof INTENTS)[number]

export interface ClassifyResult {
  intent: Intent
  confidence: number
  rawOutput: string
  fallback: boolean
  fallbackReason?: string
}

export interface IrSummary {
  projectName: string
  blockCount: number
  containerCount: number
  edgeCount: number
  topContainers: Array<{
    id: string
    name: string
    blockCount: number
  }>
  techStacks: string[]
  estimatedTokens: number
}
