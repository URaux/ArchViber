import type { EdgeProps } from '@xyflow/react'
import { RoutedEdge } from './RoutedEdge'

export function BidirectionalEdge(props: EdgeProps) {
  return <RoutedEdge {...props} variant="bidirectional" />
}
