import type { EdgeProps } from '@xyflow/react'
import { RoutedEdge } from './RoutedEdge'

export function AsyncEdge(props: EdgeProps) {
  return <RoutedEdge {...props} variant="async" />
}
