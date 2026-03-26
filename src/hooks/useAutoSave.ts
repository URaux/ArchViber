'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import type { ArchitectProject } from '@/lib/types'

export function useAutoSave(dir: string | null) {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const projectName = useAppStore((state) => state.projectName)
  const config = useAppStore((state) => state.config)
  const history = useAppStore((state) => state.history)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (!dir) {
      return
    }

    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const project: ArchitectProject = {
      name: projectName,
      version: '1.0',
      canvas: { nodes, edges },
      config,
      history,
    }

    const timeoutId = window.setTimeout(() => {
      void fetch('/api/project/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dir, project }),
      })
    }, 1000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [config, dir, edges, history, nodes, projectName])
}
