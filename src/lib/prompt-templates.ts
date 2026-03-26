interface PromptTemplateInput {
  architecture_yaml: string
  selected_nodes?: string[]
  project_context?: string
  user_feedback?: string
}

const PERSONA = [
  'You are an AI architecture consultant.',
  'Use first-principles thinking, apply Occam\'s razor, and prefer practical choices over fashionable complexity.',
].join('\n')

const CANVAS_ACTION_INSTRUCTIONS = [
  'When you recommend a canvas change, wrap it in a ```json:canvas-action block.',
  'Example:',
  '```json:canvas-action',
  '{"action": "add-node", "node": {"type": "service", "name": "CacheService", "description": "..."}}',
  '```',
].join('\n')

function formatContext(input: PromptTemplateInput) {
  return [
    'Architecture YAML:',
    input.architecture_yaml,
    '',
    `Selected nodes: ${input.selected_nodes?.join(', ') || 'none'}`,
    `Project context: ${input.project_context || 'none provided'}`,
    `User feedback: ${input.user_feedback || 'none provided'}`,
  ].join('\n')
}

function buildPrompt(
  title: string,
  task: string,
  input: PromptTemplateInput,
  includeCanvasActions: boolean
) {
  return [
    PERSONA,
    '',
    `Task: ${title}`,
    task,
    '',
    formatContext(input),
    '',
    includeCanvasActions ? CANVAS_ACTION_INSTRUCTIONS : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildAll(input: PromptTemplateInput) {
  return buildPrompt(
    'Build entire project',
    'Produce a phased implementation plan for the full architecture and call out any missing components.',
    input,
    true
  )
}

export function buildNode(input: PromptTemplateInput) {
  return buildPrompt(
    'Build selected node',
    'Focus on the selected node set, describe how to implement it, and note upstream or downstream dependencies.',
    input,
    true
  )
}

export function buildSubgraph(input: PromptTemplateInput) {
  return buildPrompt(
    'Build selected subgraph',
    'Design and sequence the selected subgraph so the resulting plan is coherent, minimal, and buildable.',
    input,
    true
  )
}

export function analyzeProject(input: PromptTemplateInput) {
  return buildPrompt(
    'Analyze project',
    'Review the architecture, identify structural risks, and recommend the simplest viable improvements.',
    input,
    false
  )
}

export function refactorNode(input: PromptTemplateInput) {
  return buildPrompt(
    'Refactor selected node',
    'Propose a refactor plan for the selected node set that reduces complexity while preserving behavior.',
    input,
    true
  )
}
