import fs from 'fs'
import path from 'path'
import type { ProjectMemory } from '@/lib/project-memory'

export const runtime = 'nodejs'

interface LoadMemoryRequest {
  workDir: string
}

export async function POST(request: Request) {
  let body: LoadMemoryRequest
  try {
    body = (await request.json()) as LoadMemoryRequest
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { workDir } = body

  if (!workDir) {
    return Response.json({ error: 'workDir is required' }, { status: 400 })
  }

  try {
    const resolvedDir = path.isAbsolute(workDir) ? workDir : path.join(process.cwd(), workDir)
    const memoryPath = path.join(resolvedDir, 'memory.json')

    if (!fs.existsSync(memoryPath)) {
      return Response.json({ nodeSummaries: null })
    }

    const raw = fs.readFileSync(memoryPath, 'utf8')
    const memory = JSON.parse(raw) as ProjectMemory

    return Response.json({ nodeSummaries: memory.nodeSummaries ?? null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Failed to load memory: ${msg}` }, { status: 500 })
  }
}
