import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from './types'

export function cloneNode(node: Node<CanvasNodeData>): Node<CanvasNodeData> {
  return {
    ...node,
    position: { ...node.position },
    data: { ...node.data },
    ...(node.style ? { style: { ...node.style } } : {}),
  }
}

export function cloneEdge(edge: Edge): Edge {
  return { ...edge, ...(edge.data ? { data: { ...edge.data } } : {}), ...(edge.style ? { style: { ...edge.style } } : {}) }
}

export function cloneCanvas(nodes: Node<CanvasNodeData>[], edges: Edge[]) {
  return {
    nodes: nodes.map(cloneNode),
    edges: edges.map(cloneEdge),
  }
}
