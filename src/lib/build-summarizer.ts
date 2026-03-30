import fs from 'fs'
import path from 'path'
import type { BuildSummary, AgentBackendType } from './types'

// --- Strategy 2: Output parsing (regex) ---

function parseBuildOutput(output: string): Pick<BuildSummary, 'filesCreated' | 'dependencies' | 'warnings' | 'errors'> {
  const filePattern = /(?:Creat(?:ed?|ing)|Wrot?e?|Writing|Generating|Generated|New file)\s+[`'"]?([^\s`'">\n]+\.\w{1,8})/gi
  const depPattern = /(?:npm\s+install|yarn\s+add|pip\s+install|pnpm\s+add|pip3\s+install)\s+((?:[\w@/.-]+\s*)+)/gi
  const warnPattern = /(?:Warning|WARN|⚠️)[:\s]+(.{10,200})/gi
  const errorPattern = /(?:Error|ERROR|✗|FAILED)[:\s]+(.{10,300})/gi

  const filesCreated: string[] = []
  const dependencies: string[] = []
  const warnings: string[] = []
  const errors: string[] = []

  let match: RegExpExecArray | null

  const fileRe = new RegExp(filePattern.source, filePattern.flags)
  while ((match = fileRe.exec(output)) !== null) {
    const f = match[1].replace(/[,;]+$/, '').trim()
    if (f && !filesCreated.includes(f)) {
      filesCreated.push(f)
    }
  }

  const depRe = new RegExp(depPattern.source, depPattern.flags)
  while ((match = depRe.exec(output)) !== null) {
    const pkgs = match[1].trim().split(/\s+/).filter((p) => p && !p.startsWith('-') && !p.startsWith('--'))
    for (const pkg of pkgs) {
      if (!dependencies.includes(pkg)) dependencies.push(pkg)
    }
  }

  const warnRe = new RegExp(warnPattern.source, warnPattern.flags)
  while ((match = warnRe.exec(output)) !== null) {
    const w = match[1].trim()
    if (w && !warnings.includes(w)) warnings.push(w)
  }

  const errRe = new RegExp(errorPattern.source, errorPattern.flags)
  while ((match = errRe.exec(output)) !== null) {
    const e = match[1].trim()
    if (e && !errors.includes(e)) errors.push(e)
  }

  return { filesCreated, dependencies, warnings, errors }
}

// --- Strategy 1: WorkDir scanning (deterministic) ---

const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next', '.turbo'])
const ENTRY_CANDIDATES = ['index.ts', 'index.tsx', 'index.js', 'main.ts', 'main.tsx', 'main.js', 'app.ts', 'app.tsx', 'app.js']

function walkDir(dir: string, rel: string, results: string[], depth: number) {
  if (depth > 6) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      walkDir(path.join(dir, entry.name), relPath, results, depth + 1)
    } else if (entry.isFile()) {
      results.push(relPath)
    }
  }
}

async function scanWorkDir(workDir: string): Promise<Pick<BuildSummary, 'filesCreated' | 'dependencies' | 'entryPoint'>> {
  if (!fs.existsSync(workDir)) {
    return { filesCreated: [], dependencies: [] }
  }

  const allFiles: string[] = []
  walkDir(workDir, '', allFiles, 0)

  const dependencies: string[] = []

  const pkgJsonPath = path.join(workDir, 'package.json')
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        dependencies.push(dep)
      }
      for (const dep of Object.keys(pkg.devDependencies ?? {})) {
        dependencies.push(`${dep} (dev)`)
      }
    } catch {
      // ignore malformed package.json
    }
  }

  const reqPath = path.join(workDir, 'requirements.txt')
  if (fs.existsSync(reqPath)) {
    try {
      const lines = fs.readFileSync(reqPath, 'utf-8').split('\n')
      for (const line of lines) {
        const clean = line.split('#')[0].trim()
        if (clean) dependencies.push(clean)
      }
    } catch {
      // ignore
    }
  }

  const entryPoint = ENTRY_CANDIDATES.find((candidate) => allFiles.includes(candidate))

  return { filesCreated: allFiles, dependencies, entryPoint }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

// --- Public API ---

export async function extractBuildSummary(
  workDir: string,
  rawOutput: string,
  _nodeId: string,
  backend: AgentBackendType,
  model: string | undefined,
  startedAt: number,
  finishedAt: number
): Promise<BuildSummary> {
  const durationMs = finishedAt - startedAt

  const [scanResult, parseResult] = await Promise.all([
    scanWorkDir(workDir),
    Promise.resolve(parseBuildOutput(rawOutput)),
  ])

  const filesCreated = dedup([...scanResult.filesCreated, ...parseResult.filesCreated])
  const dependencies = dedup([...scanResult.dependencies, ...parseResult.dependencies])
  const warnings = dedup(parseResult.warnings).slice(0, 10)
  const errors = dedup(parseResult.errors).slice(0, 10)
  const entryPoint = scanResult.entryPoint

  const outputTokenEstimate = estimateTokens(rawOutput)
  const truncatedOutput = rawOutput.length > 8000 ? rawOutput.slice(-2000) : undefined

  return {
    builtAt: finishedAt,
    durationMs,
    backend,
    model,
    filesCreated,
    filesModified: [],
    entryPoint,
    dependencies,
    techDecisions: [],
    warnings,
    errors,
    outputTokenEstimate,
    truncatedOutput,
  }
}

export function makeBuildAttemptDigest(summary: BuildSummary, status: 'done' | 'error'): string {
  if (status === 'done') {
    const deps = summary.dependencies.slice(0, 3).join(', ')
    return `Built successfully. ${summary.filesCreated.length} files${deps ? `, deps: ${deps}` : ''}.`
  }
  const firstError = summary.errors[0]?.slice(0, 100) ?? 'Unknown error'
  return `Build failed: ${firstError}`
}
