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
    expect(prompt).toContain('You are the AI assistant for ArchViber')
    expect(prompt).toContain('Implement ApiService, UserDB in')
    expect(prompt).toContain('Only modify files within:')
    expect(prompt).toContain('Write files directly to the filesystem.')
  })

  it('keeps build templates in filesystem-writing mode', () => {
    expect(buildAll(input)).toContain('Write files directly to the filesystem.')
    expect(buildNode(input)).toContain('Write files directly to the filesystem.')
    expect(buildSubgraph(input)).toContain('Write files directly to the filesystem.')
    expect(refactorNode(input)).toContain('Write files directly to the filesystem.')
    expect(buildAll(input)).not.toContain('```json:canvas-action')
    expect(buildNode(input)).not.toContain('```json:canvas-action')
  })

  it('returns an analysis prompt without dropping project context', () => {
    const prompt = analyzeProject(input)

    expect(prompt).toContain(input.architecture_yaml)
    expect(prompt).toContain(input.project_context)
    expect(prompt).toContain(input.user_feedback)
    expect(prompt).toContain('Review the architecture, identify structural risks')
    expect(prompt).toContain('```json:canvas-action')
  })
})
