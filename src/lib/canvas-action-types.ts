import type { Edge, Node } from '@xyflow/react'
import type {
  BuildStatus,
  CanvasNodeData,
  ContainerColor,
  EdgeType,
  VPNodeType,
} from './types'

export type CanvasAction =
  | {
      action: 'add-node'
      node: Partial<Node<CanvasNodeData>> & {
        type?: VPNodeType
        position?: { x?: number; y?: number }
        parentId?: string | null
        data?: Partial<CanvasNodeData>
        name?: string
        description?: string
        status?: BuildStatus
        color?: ContainerColor
        collapsed?: boolean
        techStack?: string
      }
    }
  | { action: 'update-node'; target_id: string; data: Partial<CanvasNodeData> }
  | { action: 'remove-node'; target_id: string }
  | {
      action: 'add-edge'
      edge: Partial<Edge> & {
        source: string
        target: string
        type?: EdgeType
      }
    }

export const VALID_NODE_TYPES = new Set<VPNodeType>(['container', 'block'])
export const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
export const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])
export const VALID_CONTAINER_COLORS = new Set<ContainerColor>([
  'blue',
  'green',
  'purple',
  'amber',
  'rose',
  'slate',
])

export function tryRepairJson(text: string) {
  let cleaned = text.trim()
  if (!cleaned) return null

  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const startIdx = Math.max(cleaned.indexOf('{'), cleaned.indexOf('['))
    if (startIdx === -1) return null
    cleaned = cleaned.slice(startIdx)
  }

  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false
  let lastValidIdx = 0

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i]
    if (char === '"' && !escaped) inString = !inString
    if (inString) {
      escaped = char === '\\' && !escaped
      continue
    }

    if (char === '{') openBraces += 1
    else if (char === '}') openBraces -= 1
    else if (char === '[') openBrackets += 1
    else if (char === ']') openBrackets -= 1

    if (openBraces === 0 && openBrackets === 0) {
      lastValidIdx = i + 1
    }
  }

  let candidate = cleaned
  if (openBraces > 0 || openBrackets > 0 || inString) {
    if (inString) candidate += '"'
    candidate += '}'.repeat(Math.max(0, openBraces))
    candidate += ']'.repeat(Math.max(0, openBrackets))
  }

  try {
    return JSON.parse(candidate)
  } catch {
    if (lastValidIdx > 0) {
      try {
        return JSON.parse(cleaned.slice(0, lastValidIdx))
      } catch {
        return null
      }
    }

    return null
  }
}
