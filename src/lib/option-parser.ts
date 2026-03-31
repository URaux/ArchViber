interface ParsedOption {
  number: string
  text: string
}

export interface ParsedOptions {
  options: ParsedOption[]
  textBefore: string
  textAfter: string
}

export function parseOptions(content: string): ParsedOptions | null {
  // Match patterns like:
  // 1. Option text
  // 2、Option text
  // 1) Option text
  const lines = content.split('\n')
  const optionPattern = /^\s*(\d+)[.、．)\s]+\s*(.+)$/

  let firstOptionIndex = -1
  let lastOptionIndex = -1
  const options: ParsedOption[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = optionPattern.exec(lines[i])
    if (match) {
      if (firstOptionIndex === -1) firstOptionIndex = i
      lastOptionIndex = i
      options.push({ number: match[1], text: match[2].trim() })
    }
  }

  // Need at least 2 options to trigger card rendering
  if (options.length < 2) return null

  // Check options are roughly consecutive (allow up to 1 blank line between each)
  const optionLineSpan = lastOptionIndex - firstOptionIndex + 1
  if (optionLineSpan > options.length * 2) return null

  const textBefore = lines.slice(0, firstOptionIndex).join('\n').trim()
  const textAfter = lines.slice(lastOptionIndex + 1).join('\n').trim()

  return { options, textBefore, textAfter }
}
