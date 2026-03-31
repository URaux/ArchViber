import { resolveSkillsForTask } from '@/lib/skill-loader'

export const runtime = 'nodejs'

interface NodeInput {
  id: string
  techStack?: string
}

interface ResolveRequestBody {
  nodes: NodeInput[]
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResolveRequestBody

    if (!body.nodes || !Array.isArray(body.nodes)) {
      return Response.json({ error: 'nodes array is required' }, { status: 400 })
    }

    const nodeSkills: Record<
      string,
      Array<{ name: string; reason: string; category: string; priority: number }>
    > = {}

    for (const node of body.nodes) {
      const resolved = resolveSkillsForTask('build', 'node', node.techStack)
      nodeSkills[node.id] = resolved.map((s) => ({
        name: s.metadata.name,
        reason: s.reason,
        category: s.metadata.category,
        priority: s.metadata.priority,
      }))
    }

    return Response.json({ nodeSkills })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve skills' },
      { status: 500 }
    )
  }
}
