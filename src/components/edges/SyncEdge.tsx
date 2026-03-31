import type { EdgeProps } from '@xyflow/react'
import { RoutedEdge } from './RoutedEdge'

export function SyncEdge(props: EdgeProps) {
  return <RoutedEdge {...props} variant="sync" />
}
