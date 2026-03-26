import type { AgentStatus } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StatusEventPayload {
  agentId: string
  nodeId: string
  status: AgentStatus
}

interface OutputEventPayload {
  agentId: string
  nodeId: string
  text: string
}

interface WaveEventPayload {
  wave: number
}

function toBuildStatus(status: AgentStatus) {
  return status === 'running' ? 'building' : status
}

function encodeEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function GET(request: Request) {
  let cleanup = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const close = () => {
        if (closed) {
          return
        }

        closed = true
        cleanup()
        controller.close()
      }

      const push = (payload: unknown) => {
        if (closed) {
          return
        }

        controller.enqueue(encodeEvent(payload))
      }

      const handleStatus = ({ nodeId, status }: StatusEventPayload) => {
        push({ type: 'status', nodeId, status: toBuildStatus(status) })
      }

      const handleOutput = ({ nodeId, text }: OutputEventPayload) => {
        push({ type: 'output', nodeId, text })
      }

      const handleWave = ({ wave }: WaveEventPayload) => {
        push({ type: 'wave', wave })
      }

      cleanup = () => {
        agentRunner.off('status', handleStatus)
        agentRunner.off('output', handleOutput)
        agentRunner.off('wave', handleWave)
      }

      agentRunner.on('status', handleStatus)
      agentRunner.on('output', handleOutput)
      agentRunner.on('wave', handleWave)
      request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
  })
}
