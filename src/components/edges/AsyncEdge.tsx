import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'

export function AsyncEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath({ ...props, borderRadius: 10 })

  const midX = ((props.sourceX ?? 0) + (props.targetX ?? 0)) / 2
  const midY = ((props.sourceY ?? 0) + (props.targetY ?? 0)) / 2

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#arrow)"
        style={{ stroke: '#94a3b8', strokeWidth: 1.25, strokeDasharray: '5 5' }}
      />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${midX}px,${midY}px)`,
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
