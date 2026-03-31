import fs from 'fs'
import path from 'path'
import type { BuildSummary } from '@/lib/types'
import type { ProjectMemory } from '@/lib/project-memory'

export const runtime = 'nodejs'

interface SaveMemoryRequest {
  workDir: string
  projectName: string
  nodeSummaries: Record<string, BuildSummary>
}

export async function POST(request: Request) {
  let body: SaveMemoryRequest
  try {
    body = (await request.json()) as SaveMemoryRequest
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { workDir, projectName, nodeSummaries } = body

  if (!workDir) {
    return Response.json({ error: 'workDir is required' }, { status: 400 })
  }

  try {
    // Resolve relative paths from CWD (same convention as agent-runner)
    const resolvedDir = path.isAbsolute(workDir) ? workDir : path.join(process.cwd(), workDir)

    // Ensure directory exists
    fs.mkdirSync(resolvedDir, { recursive: true })

    const memoryPath = path.join(resolvedDir, 'memory.json')

    // Merge with existing memory so partial saves don't overwrite other nodes
    let existing: ProjectMemory | null = null
    try {
      const raw = fs.readFileSync(memoryPath, 'utf8')
      existing = JSON.parse(raw) as ProjectMemory
    } catch {
      // No existing file — start fresh
    }

    const updated: ProjectMemory = {
      projectName: projectName ?? existing?.projectName ?? '',
      updatedAt: new Date().toISOString(),
      nodeSummaries: {
        ...(existing?.nodeSummaries ?? {}),
        ...nodeSummaries,
      },
    }

    fs.writeFileSync(memoryPath, JSON.stringify(updated, null, 2), 'utf8')

    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Failed to save memory: ${msg}` }, { status: 500 })
  }
}
