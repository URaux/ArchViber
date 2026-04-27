import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface DispatchTrace {
  timestamp: string
  intent: string
  promptHash: string
  classifierConfidence: number
  dispatchStatus: 'ok' | 'not_implemented' | 'error'
  error?: string
  durationMs: number
}

const DEFAULT_TRACE_PATH = path.join('.archviber', 'cache', 'dispatch-trace.jsonl')
const ROLL_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

function traceEnabled(): boolean {
  return process.env.ARCHVIBER_TRACE !== '0'
}

function tracePath(): string {
  return process.env.ARCHVIBER_TRACE_FILE ?? DEFAULT_TRACE_PATH
}

export function hashPrompt(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

async function rollIfNeeded(target: string): Promise<void> {
  let size: number
  try {
    const stat = await fs.stat(target)
    size = stat.size
  } catch {
    return
  }
  if (size < ROLL_SIZE_BYTES) return
  const rolled = `${target}.${Date.now()}.bak`
  await fs.rename(target, rolled)
}

export async function appendDispatchTrace(trace: DispatchTrace): Promise<void> {
  if (!traceEnabled()) return
  const target = tracePath()
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await rollIfNeeded(target)
    await fs.appendFile(target, `${JSON.stringify(trace)}\n`, 'utf8')
  } catch {
    // Fire-and-forget; never throw into the dispatch path.
  }
}

export async function readRecentTraces(limit = 100): Promise<DispatchTrace[]> {
  const target = tracePath()
  let text: string
  try {
    text = await fs.readFile(target, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const lines = text.split('\n').filter((l) => l.length > 0)
  const tail = lines.slice(Math.max(0, lines.length - limit))
  const out: DispatchTrace[] = []
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as DispatchTrace)
    } catch {
      // Skip malformed lines.
    }
  }
  return out
}
