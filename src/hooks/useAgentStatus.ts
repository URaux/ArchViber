'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import type { BuildStatus, BuildSummary, BuildAttempt } from '@/lib/types'
import { getDownstreamDependents } from '@/lib/topo-sort'

/** Mirror of the slug logic in useBuildActions — must stay in sync. */
function toProjectSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  )
}

function getProjectWorkDir(workDir: string, projectName: string): string {
  return `${workDir}/${toProjectSlug(projectName)}`
}

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

interface BuildSummaryMessage {
  type: 'build-summary'
  nodeId: string
  summary: BuildSummary
}

type AgentStreamMessage = StatusMessage | OutputMessage | WaveMessage | BuildSummaryMessage

function getLatestLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
}

export function useAgentStatus() {
  // On mount, restore BuildSummaries persisted from a previous session (Memory L1).
  useEffect(() => {
    const store = useAppStore.getState()
    const workDir = getProjectWorkDir(store.config.workDir, store.projectName)

    void fetch('/api/project/memory/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir }),
    })
      .then((res) => res.json())
      .then((data: { nodeSummaries: Record<string, BuildSummary> | null }) => {
        if (!data.nodeSummaries) return
        const currentStore = useAppStore.getState()
        for (const [nodeId, summary] of Object.entries(data.nodeSummaries)) {
          const node = currentStore.nodes.find((n) => n.id === nodeId)
          if (!node || node.type !== 'block') continue
          const existing = (node.data as import('@/lib/types').BlockNodeData).buildSummary
          // Only restore if the node doesn't already have a summary (don't overwrite live data)
          if (!existing) {
            currentStore.updateNodeData(nodeId, { buildSummary: summary })
          }
        }
      })
      .catch(() => {
        // Non-fatal — memory restoration is best-effort
      })
  }, [])

  // On mount, check server-side build progress to restore state after page refresh.
  // If a build was in progress when the user refreshed, the SSE connection dropped
  // but the server may still have the last-known state.
  useEffect(() => {
    void fetch('/api/agent/build-state')
      .then((res) => res.json())
      .then((data: { progress: import('@/lib/build-state').BuildProgress | null }) => {
        if (!data.progress?.active) return
        const store = useAppStore.getState()
        // Only restore if the client doesn't already have an active build
        if (!store.buildState.active) {
          store.setBuildState({
            active: true,
            waves: data.progress.waves,
            currentWave: data.progress.currentWave,
            totalWaves: data.progress.waves.length,
            targetNodeIds: data.progress.waves.flat(),
            startedAt: data.progress.startedAt,
          })
        }
      })
      .catch(() => {
        // Non-fatal — build state restoration is best-effort
      })
  }, [])

  useEffect(() => {
    const eventSource = new EventSource('/api/agent/stream')

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as AgentStreamMessage
      const store = useAppStore.getState()

      if (payload.type === 'status') {
        store.updateNodeStatus(payload.nodeId, payload.status)

        // Record timing data
        if (payload.status === 'building') {
          const timings = { ...store.buildState.nodeTimings }
          timings[payload.nodeId] = { startedAt: Date.now() }
          store.setBuildState({ nodeTimings: timings })
        }

        if (payload.status === 'done' || payload.status === 'error') {
          const timings = { ...store.buildState.nodeTimings }
          const existing = timings[payload.nodeId] ?? {}
          timings[payload.nodeId] = { ...existing, finishedAt: Date.now() }
          store.setBuildState({ nodeTimings: timings })

          // Push a system message into the active chat session so the Chat agent
          // has passive awareness of build completions and failures.
          const node = store.nodes.find((n) => n.id === payload.nodeId)
          const name = (node?.data as import('@/lib/types').BlockNodeData | undefined)?.name || payload.nodeId

          if (payload.status === 'done') {
            store.appendSystemChatMessage(`[构建] ${name} 构建完成`)
          } else {
            const output = store.buildOutputLog[payload.nodeId] ?? ''
            const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1) ?? ''
            const errorMsg = lastLine || (node?.data as import('@/lib/types').BlockNodeData | undefined)?.errorMessage || '未知错误'
            store.appendSystemChatMessage(`[构建] ${name} 构建失败: ${errorMsg.slice(0, 150)}`)
          }
        }

        // When a node errors, block its downstream dependents
        if (payload.status === 'error') {
          const state = useAppStore.getState()
          const dependents = getDownstreamDependents(
            payload.nodeId,
            state.buildState.targetNodeIds,
            state.edges
          )
          if (dependents.length > 0) {
            const newBlocked = { ...state.buildState.blockedNodes }
            for (const depId of dependents) {
              const depNode = state.nodes.find((n) => n.id === depId)
              if (depNode && depNode.data.status !== 'done' && depNode.data.status !== 'error') {
                newBlocked[depId] = payload.nodeId
                state.updateNodeStatus(depId, 'blocked')
              }
            }
            state.setBuildState({ blockedNodes: newBlocked })
          }
        }

        const nextState = useAppStore.getState()
        const allFinished =
          nextState.buildState.active &&
          nextState.buildState.targetNodeIds.length > 0 &&
          nextState.buildState.targetNodeIds.every((nodeId) => {
            const node = nextState.nodes.find((entry) => entry.id === nodeId)
            return node
              ? node.data.status === 'done' ||
                  node.data.status === 'error' ||
                  node.data.status === 'blocked'
              : true
          })

        if (allFinished) {
          nextState.setBuildState({
            active: false,
            currentWave: nextState.buildState.totalWaves,
            targetNodeIds: nextState.buildState.targetNodeIds,
            completedAt: Date.now(),
          })
        }

        return
      }

      if (payload.type === 'output') {
        store.appendBuildOutput(payload.nodeId, payload.text)

        const summary = getLatestLine(payload.text)

        if (summary) {
          store.updateNodeData(payload.nodeId, { summary })
        }

        return
      }

      if (payload.type === 'wave') {
        store.setBuildState({ active: true, currentWave: payload.wave + 1 })
        return
      }

      if (payload.type === 'build-summary') {
        const { summary, nodeId } = payload
        const state = useAppStore.getState()
        const node = state.nodes.find((n) => n.id === nodeId)
        if (!node || node.type !== 'block') return

        const nodeData = node.data as import('@/lib/types').BlockNodeData
        const previousSummary = nodeData.buildSummary
        const existingHistory: BuildAttempt[] = nodeData.buildHistory ?? []

        let nextHistory = existingHistory

        // Rotate previous buildSummary into history before replacing
        if (previousSummary) {
          const deps = previousSummary.dependencies.slice(0, 3).join(', ')
          const attemptDigest = `Built successfully. ${previousSummary.filesCreated.length} files${deps ? `, deps: ${deps}` : ''}.`
          const attempt: BuildAttempt = {
            builtAt: previousSummary.builtAt,
            status: 'done',
            durationMs: previousSummary.durationMs,
            backend: previousSummary.backend,
            model: previousSummary.model,
            summaryDigest: attemptDigest,
            filesCreated: previousSummary.filesCreated,
          }
          nextHistory = [...existingHistory, attempt].slice(-5)
        }

        store.updateNodeData(nodeId, {
          buildSummary: summary,
          buildHistory: nextHistory,
        })

        // Persist BuildSummary to memory.json (Memory L1 — fire and forget)
        const currentStore = useAppStore.getState()
        const workDir = getProjectWorkDir(currentStore.config.workDir, currentStore.projectName)
        fetch('/api/project/memory/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workDir,
            projectName: currentStore.projectName,
            nodeSummaries: { [nodeId]: summary },
          }),
        }).catch(() => {
          // Non-fatal — persistence is best-effort
        })

        return
      }
    }

    return () => {
      eventSource.close()
    }
  }, [])
}
