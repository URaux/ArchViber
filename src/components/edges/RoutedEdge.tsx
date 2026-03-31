import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { routeCrossContainerEdge, getContainerBox } from '@/lib/edge-routing'

export type EdgeVariant = 'sync' | 'async' | 'bidirectional'

interface RoutedEdgeProps extends EdgeProps {
  variant: EdgeVariant
}

export function RoutedEdge({ variant, ...props }: RoutedEdgeProps) {
  const { getNodes } = useReactFlow()

  const isIntraContainer = props.data?.isIntraContainer as boolean | undefined

  let edgePath: string
  let labelX: number
  let labelY: number

  if (!isIntraContainer) {
    const nodes = getNodes()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    const sourceNode = nodeMap.get(props.source)
    const targetNode = nodeMap.get(props.target)

    const sourceContainer = getContainerBox(sourceNode?.parentId, nodeMap)
    const targetContainer = getContainerBox(targetNode?.parentId, nodeMap)

    const result = routeCrossContainerEdge(
      props.sourceX,
      props.sourceY,
      props.sourceHandleId,
      props.targetX,
      props.targetY,
      props.targetHandleId,
      sourceContainer,
      targetContainer
    )

    if (result) {
      edgePath = result.path
      labelX = result.labelX
      labelY = result.labelY
    } else {
      const [p] = getSmoothStepPath({ ...props, borderRadius: 10 })
      edgePath = p
      labelX = (props.sourceX ?? 0) * 0.4 + (props.targetX ?? 0) * 0.6
      labelY = (props.sourceY ?? 0) * 0.4 + (props.targetY ?? 0) * 0.6
    }
  } else {
    const [p] = getSmoothStepPath({ ...props, borderRadius: 10 })
    edgePath = p
    labelX = (props.sourceX ?? 0) * 0.4 + (props.targetX ?? 0) * 0.6
    labelY = (props.sourceY ?? 0) * 0.4 + (props.targetY ?? 0) * 0.6
  }

  const baseStyle: React.CSSProperties = { stroke: '#94a3b8', strokeWidth: 1.25 }
  if (variant === 'async') baseStyle.strokeDasharray = '5 5'

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#arrow)"
        {...(variant === 'bidirectional' ? { markerStart: 'url(#arrow-reverse)' } : {})}
        style={baseStyle}
      />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: 1000,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
