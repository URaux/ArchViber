interface JsonLike {
  [key: string]: unknown
}

function isObject(value: unknown): value is JsonLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractTextBlocks(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .map((entry) => {
      if (!isObject(entry)) {
        return ''
      }

      return typeof entry.text === 'string' ? entry.text : ''
    })
    .join('')
}

function extractTextFromEvent(event: unknown): string {
  if (!isObject(event)) {
    return ''
  }

  if (typeof event.result === 'string') {
    return event.result
  }

  if (typeof event.output_text === 'string') {
    return event.output_text
  }

  if (typeof event.text === 'string' && (event.type === 'text' || event.role === 'assistant')) {
    return event.text
  }

  if (isObject(event.delta) && typeof event.delta.text === 'string') {
    return event.delta.text
  }

  if (isObject(event.content_block) && typeof event.content_block.text === 'string') {
    return event.content_block.text
  }

  if (isObject(event.message)) {
    const content = extractTextBlocks(event.message.content)

    if (content) {
      return content
    }
  }

  return extractTextBlocks(event.content)
}

export function extractAgentText(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()

      if (!trimmed) {
        return ''
      }

      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return `${line}\n`
      }

      try {
        return extractTextFromEvent(JSON.parse(trimmed))
      } catch {
        return `${line}\n`
      }
    })
    .join('')
}

export function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fencedMatch?.[1], text.trim()]

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    try {
      return JSON.parse(candidate) as unknown
    } catch {
      continue
    }
  }

  return null
}
