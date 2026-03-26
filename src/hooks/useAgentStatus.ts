'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import type { BuildStatus } from '@/lib/types'

interface StatusMessage {
  type: 'status'
  nodeId: string
  status: BuildStatus
}

interface OutputMessage {
  type: 'output'
  nodeId: string
  text: string
}

interface WaveMessage {
  type: 'wave'
  wave: number
}

type AgentStreamMessage = StatusMessage | OutputMessage | WaveMessage

function getLatestLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
}

export function useAgentStatus() {
  useEffect(() => {
    const eventSource = new EventSource('/api/agent/stream')

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as AgentStreamMessage
      const store = useAppStore.getState()

      if (payload.type === 'status') {
        store.updateNodeStatus(payload.nodeId, payload.status)
        return
      }

      if (payload.type === 'output') {
        const summary = getLatestLine(payload.text)

        if (summary) {
          store.updateNodeData(payload.nodeId, { summary })
        }
      }
    }

    return () => {
      eventSource.close()
    }
  }, [])
}
