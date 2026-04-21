import { promises as fs } from 'node:fs'
import path from 'node:path'
import { INTENTS } from './types'

export interface ClassifyLogEntry {
  timestamp: string
  prompt: string
  intent: (typeof INTENTS)[number]
  confidence: number
  fallback: boolean
  fallbackReason?: string
  durationMs: number
}

const DEFAULT_LOG_PATH = path.join('.archviber', 'cache', 'classifier-log.jsonl')

export async function appendClassifyLog(
  entry: ClassifyLogEntry,
  opts: { path?: string } = {}
): Promise<void> {
  const targetPath = opts.path ?? DEFAULT_LOG_PATH

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.warn('[orchestrator/classifier-log] Failed to append log entry', error)
  }
}
