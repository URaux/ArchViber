/**
 * Reusable streaming HTTP LLM client — OpenAI-compatible chat completions API.
 * Used by the chat route to bypass CLI subprocess cold start.
 */

export interface LlmConfig {
  apiBase: string
  apiKey: string
  model: string
}

/**
 * Yields text delta chunks from a streaming chat completions request.
 */
export async function* streamChat(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  config: LlmConfig,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`)
    throw new Error(`LLM API error: ${errText.slice(0, 300)}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from LLM API')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const content = parsed.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
