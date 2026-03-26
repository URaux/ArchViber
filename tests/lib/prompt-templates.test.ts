import { describe, expect, it } from 'vitest'
import {
  analyzeProject,
  buildAll,
  buildNode,
  buildSubgraph,
  refactorNode,
} from '@/lib/prompt-templates'

describe('prompt-templates', () => {
  const input = {
    architecture_yaml: 'project: demo\nservices:\n  - name: ApiService',
    selected_nodes: ['ApiService', 'UserDB'],
    project_context: 'Current priority is shipping the onboarding flow.',
    user_feedback: 'Keep the design simple and avoid new infrastructure.',
  }

  it('interpolates variables and persona into build prompts', () => {
    const prompt = buildNode(input)

    expect(prompt).toContain(input.architecture_yaml)
    expect(prompt).toContain('ApiService, UserDB')
    expect(prompt).toContain(input.project_context)
    expect(prompt).toContain(input.user_feedback)
    expect(prompt).toContain("first-principles")
    expect(prompt).toContain("Occam's razor")
    expect(prompt).toContain('practical choices')
    expect(prompt).toContain('```json:canvas-action')
  })

  it('applies canvas-action instructions to canvas-modifying templates', () => {
    expect(buildAll(input)).toContain('```json:canvas-action')
    expect(buildNode(input)).toContain('```json:canvas-action')
    expect(buildSubgraph(input)).toContain('```json:canvas-action')
    expect(refactorNode(input)).toContain('```json:canvas-action')
  })

  it('returns an analysis prompt without dropping project context', () => {
    const prompt = analyzeProject(input)

    expect(prompt).toContain(input.architecture_yaml)
    expect(prompt).toContain(input.project_context)
    expect(prompt).toContain(input.user_feedback)
    expect(prompt).toContain("Occam's razor")
  })
})
