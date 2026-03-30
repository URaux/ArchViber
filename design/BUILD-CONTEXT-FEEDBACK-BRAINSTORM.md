# Build-to-Chat Context Feedback Loop

> Deep brainstorm. The problem: after Build completes, Chat is blind. It only sees the YAML architecture description -- not what code was generated, what libraries were installed, what decisions were made, or what went wrong. This makes post-build conversations uninformed and frustrating.

---

## The Knowledge Gap (Current State)

```
BUILD AGENT                              CHAT AGENT

Spawns subprocess ──────────────────►   Knows nothing about this
Writes files to workDir ────────────►   Can't read workDir
Installs dependencies ──────────────►   Doesn't know what was installed
Makes implementation decisions ─────►   Can't see decisions
Encounters errors, works around them ►  Can't see workarounds
Emits raw output to buildOutputLog ──►  Doesn't read buildOutputLog

What Chat actually sees:
  - Architecture YAML (pre-build)
  - Node name, description, status
  - Connected edges
  - techStack string (if set)

What Chat SHOULD see:
  - Files created and their purposes
  - Libraries/dependencies installed
  - Key implementation decisions
  - Warnings, caveats, known issues
  - Error messages from failed builds
  - What changed since last build
```

### Where context flows today

```
ChatPanel.tsx
  └─► buildNodeContext()
        ├─ node.id, node.type, node.name
        ├─ node.description, node.status
        ├─ node.techStack
        └─ connected edges
  └─► canvasToYaml()
        └─ full architecture YAML (names, descriptions, edges)
  └─► POST /api/chat/route.ts
        └─► buildPrompt()
              ├─ buildSystemContext() (persona + language + canvas-action instructions)
              ├─ architecture_yaml
              ├─ nodeContext (the buildNodeContext output above)
              ├─ conversation history
              └─ user message
```

Notice: `buildOutputLog` from the store is never read by Chat. It's only rendered in `OutputLog.tsx` for the build drawer UI.

---

## Design: Build Summary Extraction

### What the summary should contain

A structured object, not free text. Free text is unreliable for downstream consumption.

```typescript
interface BuildSummary {
  // When and how
  builtAt: number                    // timestamp
  durationMs: number                 // build duration
  backend: AgentBackendType          // which agent backend was used
  model?: string                     // which model

  // What was produced
  filesCreated: string[]             // relative paths from workDir
  filesModified: string[]            // for rebuilds
  entryPoint?: string                // main file if detectable

  // What was used
  dependencies: string[]             // npm packages, pip packages, etc.
  techDecisions: string[]            // max 5, human-readable strings
  // e.g. ["Used Prisma ORM instead of raw SQL", "Chose WebSocket over SSE for real-time"]

  // What went wrong
  warnings: string[]                 // non-fatal issues
  errors: string[]                   // only populated on status='error'

  // Raw output stats
  outputTokenEstimate: number        // rough size of raw output
  truncatedOutput?: string           // last 2000 chars of raw output (fallback context)
}
```

### Where to store it: `BlockNodeData.buildSummary`

Add it directly to the node. This is the right place because:
- Summary is per-node (each block builds independently)
- It persists with the canvas (save/load works automatically)
- Chat already reads node data via `buildNodeContext()`
- No new store fields needed, no separate data structure to sync

```typescript
// types.ts — updated BlockNodeData
export interface BlockNodeData extends Record<string, unknown> {
  name: string
  description: string
  status: BuildStatus
  summary?: string              // existing: last line of build output (live progress)
  errorMessage?: string         // existing
  techStack?: string            // existing
  buildSummary?: BuildSummary   // NEW: structured post-build context
  buildHistory?: BuildAttempt[] // NEW: previous build attempts (see section 3)
}

interface BuildAttempt {
  builtAt: number
  status: 'done' | 'error'
  durationMs: number
  summaryDigest: string         // 1-2 sentence summary of what happened
  errorMessage?: string         // if failed
}
```

### How to extract it: Hybrid approach

Three extraction strategies, in order of reliability:

**Strategy 1: Directory scanning (deterministic, reliable)**
After build completes, scan `workDir` for the node's files. This gives us `filesCreated` with 100% accuracy.

```typescript
// post-build-summarizer.ts
async function scanBuildArtifacts(workDir: string, nodeId: string): Promise<Partial<BuildSummary>> {
  const nodeDir = path.join(workDir, nodeId) // convention: each node builds into workDir/

  // If no node-specific dir, scan whole workDir for changes
  const files = await glob('**/*', { cwd: workDir, nodir: true })

  // Detect package managers
  const deps: string[] = []
  const pkgJsonPath = path.join(workDir, 'package.json')
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    deps.push(...Object.keys(pkg.dependencies ?? {}))
    deps.push(...Object.keys(pkg.devDependencies ?? {}).map(d => `${d} (dev)`))
  }

  return { filesCreated: files, dependencies: deps }
}
```

**Strategy 2: Output parsing (regex, fast, imperfect)**
Parse the build output for common patterns. Build agents (Claude Code, Codex, Gemini) emit recognizable patterns:

```typescript
function parseBuildOutput(output: string): Partial<BuildSummary> {
  const filePatterns = /(?:Created?|Wrote|Writing|Generating)\s+[`']?([^\s`']+\.\w{1,5})/gi
  const depPatterns = /(?:npm install|yarn add|pip install|pnpm add)\s+(.+)/gi
  const warningPatterns = /(?:Warning|WARN|⚠️):?\s*(.+)/gi

  const filesCreated = [...output.matchAll(filePatterns)].map(m => m[1])
  const dependencies = [...output.matchAll(depPatterns)].flatMap(m => m[1].split(/\s+/))
  const warnings = [...output.matchAll(warningPatterns)].map(m => m[1])

  return { filesCreated, dependencies, warnings }
}
```

**Strategy 3: LLM summarization (expensive, most informative)**
Ask a cheap/fast model to summarize the build output into the `BuildSummary` schema. This gives us `techDecisions` which regex can't extract.

```typescript
async function llmSummarize(output: string, nodeName: string): Promise<Partial<BuildSummary>> {
  // Use title-gen style direct API call, not a full agent spawn
  // Truncate output to last 4000 chars to save tokens
  const truncated = output.slice(-4000)

  const prompt = `Analyze this build output for the "${nodeName}" component.
Return JSON matching this schema:
{
  "filesCreated": ["file paths mentioned"],
  "dependencies": ["packages installed"],
  "techDecisions": ["key implementation choices, max 5"],
  "warnings": ["any warnings or caveats"]
}
Only include facts explicitly stated in the output. Do not infer or guess.

Build output:
${truncated}`

  // Direct API call, not agent spawn
  const result = await cheapLLMCall(prompt)
  return JSON.parse(result)
}
```

**Recommended: Strategy 1 + 2, with Strategy 3 as optional enhancement**

Strategy 1 (directory scan) is reliable and free. Strategy 2 (regex) catches most patterns at zero cost. Strategy 3 (LLM) adds the most value for `techDecisions` but costs tokens and latency. Make it configurable.

### Extraction timing and flow

```
AgentRunner emits 'done' event
       │
       ▼
useAgentStatus.ts receives status='done'
       │
       ▼
POST /api/agent/summarize (new endpoint)
  ├── scanBuildArtifacts(workDir)        ← Strategy 1 (always)
  ├── parseBuildOutput(rawOutput)        ← Strategy 2 (always)
  ├── llmSummarize(rawOutput, nodeName)  ← Strategy 3 (if enabled)
  └── merge results → BuildSummary
       │
       ▼
store.updateNodeData(nodeId, { buildSummary })
       │
       ▼
buildNodeContext() now includes buildSummary
       │
       ▼
Chat agent sees post-build context ✓
```

Alternative (simpler): do the extraction server-side in the existing build API route, right after the agent finishes. No new endpoint needed.

```
// In the build API route or AgentRunner 'done' handler:
agentRunner.on('done', async ({ agentId, nodeId, output }) => {
  const info = agentRunner.getStatus(agentId)
  if (!info) return

  const summary = await extractBuildSummary(info.workDir, output, nodeName)

  // Emit as a new SSE event type
  emit('build-summary', { nodeId, summary })
})
```

Then `useAgentStatus.ts` handles the new event type:

```typescript
if (payload.type === 'build-summary') {
  store.updateNodeData(payload.nodeId, { buildSummary: payload.summary })
}
```

---

## Design: Context Injection into Chat

### How buildSummary flows into Chat's prompt

Modify `buildNodeContext()` in `ChatPanel.tsx`:

```typescript
function buildNodeContext(
  selectedNodeId: string | null,
  nodes: CanvasNode[],
  edges: Edge[]
) {
  // ... existing node lookup and edge summary ...

  const sections = [
    `Node id: ${selectedNode.id}`,
    `Node type: ${selectedNode.type}`,
    `Node name: ${selectedNode.data.name || selectedNode.id}`,
    `Description: ${selectedNode.data.description || 'None provided.'}`,
    `Status: ${selectedNode.data.status}`,
    `Tech stack: ${selectedNode.data.techStack || 'Not specified.'}`,
    'Connected edges:',
    edgeSummary,
  ]

  // NEW: inject build summary if available
  const bs = selectedNode.data.buildSummary
  if (bs) {
    sections.push('')
    sections.push('## Build Results (from last successful build)')
    sections.push(`Built at: ${new Date(bs.builtAt).toISOString()}`)
    sections.push(`Duration: ${(bs.durationMs / 1000).toFixed(1)}s`)
    sections.push(`Backend: ${bs.backend}${bs.model ? ` (${bs.model})` : ''}`)

    if (bs.filesCreated.length > 0) {
      sections.push(`Files created: ${bs.filesCreated.join(', ')}`)
    }
    if (bs.dependencies.length > 0) {
      sections.push(`Dependencies: ${bs.dependencies.join(', ')}`)
    }
    if (bs.techDecisions.length > 0) {
      sections.push('Key decisions:')
      bs.techDecisions.forEach(d => sections.push(`- ${d}`))
    }
    if (bs.warnings.length > 0) {
      sections.push('Warnings:')
      bs.warnings.forEach(w => sections.push(`- ${w}`))
    }
  }

  // NEW: inject error info if build failed
  if (selectedNode.data.status === 'error' && selectedNode.data.errorMessage) {
    sections.push('')
    sections.push('## Build Error')
    sections.push(selectedNode.data.errorMessage)
  }

  return sections.join('\n')
}
```

### How it fits in the 7-layer context stack

From MULTI-AGENT-BRAINSTORM.md:

```
Layer 7: Output Format
Layer 6: Constraints
Layer 5: Skills (domain knowledge)
Layer 4: Task Definition
Layer 3: Canvas State              ← BUILD SUMMARY GOES HERE
Layer 2: Conversation History
Layer 1: Identity
Layer 0: Language
```

Build summary is part of Layer 3 (Canvas State). It's not a new layer -- it's enriched canvas state. The node now carries not just its declared architecture (name, description, techStack) but also its realized implementation (files, deps, decisions).

This is conceptually clean: Layer 3 answers "what is the current state of this architecture?" Before build, that's the YAML description. After build, it includes what was actually built.

---

## Design: On-Demand Code Reading

### The problem

Build summary tells Chat WHAT files exist. But sometimes the user asks "how does the auth middleware work?" or "why did you use X pattern?" -- this requires reading actual file contents.

### File discovery: How to know which files belong to which node

Three approaches, ranked by reliability:

**Approach A: workDir convention (simplest, recommended)**
Each node builds into `{workDir}/`. Since Vibe Pencil controls the build prompt, we can enforce a directory convention. But in practice, build agents write files wherever they want -- we can't enforce subdirectories per node.

Better: use the `filesCreated` list from BuildSummary. We already have it.

**Approach B: workDir diffing**
Snapshot the workDir file list before build starts, diff after build completes. The delta is what the node created.

```typescript
// Before build
const beforeFiles = new Set(await glob('**/*', { cwd: workDir }))

// After build
const afterFiles = await glob('**/*', { cwd: workDir })
const newFiles = afterFiles.filter(f => !beforeFiles.has(f))
```

This is more reliable than regex parsing and works regardless of build agent output format. **This should be the primary method for `filesCreated`.**

**Approach C: Git diff**
If workDir is a git repo (or we init one), `git diff --name-only` gives us exactly what changed. Most reliable option but requires git.

### Reading strategy: Token budget management

```typescript
interface CodeReadingConfig {
  maxTotalTokens: number     // 4000 tokens default
  maxFileTokens: number      // 1500 tokens per file
  maxFiles: number           // 5 files max
  priorityPatterns: string[] // files to read first
}

const DEFAULT_PRIORITY = [
  '**/index.{ts,tsx,js,jsx}',
  '**/app.{ts,tsx,js,jsx}',
  '**/main.{ts,tsx,js,jsx}',
  '**/package.json',
  '**/README.md',
  '**/*.config.{ts,js}',
]

async function readNodeFiles(
  workDir: string,
  filesCreated: string[],
  config: CodeReadingConfig = defaults
): Promise<string> {
  // Sort by priority, take top N
  const prioritized = sortByPriority(filesCreated, config.priorityPatterns)
  const selected = prioritized.slice(0, config.maxFiles)

  const sections: string[] = []
  let totalTokens = 0

  for (const file of selected) {
    const content = await fs.readFile(path.join(workDir, file), 'utf-8')
    const tokens = estimateTokens(content)

    if (totalTokens + tokens > config.maxTotalTokens) {
      // Truncate this file
      const remaining = config.maxTotalTokens - totalTokens
      const truncated = content.slice(0, remaining * 4) // ~4 chars per token
      sections.push(`--- ${file} (truncated) ---\n${truncated}\n...`)
      break
    }

    sections.push(`--- ${file} ---\n${content}`)
    totalTokens += tokens
  }

  // List remaining files we didn't read
  const unread = prioritized.slice(config.maxFiles)
  if (unread.length > 0) {
    sections.push(`\nOther files (not shown): ${unread.join(', ')}`)
  }

  return sections.join('\n\n')
}
```

### When to read: On-demand, not automatic

Reading files is expensive (token budget). Don't inject file contents into every chat message. Instead:

**Option A: Explicit trigger** -- User clicks a "Load code context" button in the chat panel when they want file-aware conversation. This adds a `codeContext` field to the chat request.

**Option B: Smart detection** -- When the user's message references code (`"how does X work"`, `"show me the code for"`, `"why did you use"`), the chat route detects this and reads relevant files server-side before passing to the agent.

**Option C: Chat agent tool use** -- Give the chat agent a `read_file` tool that it can call when it needs code context. This is the most flexible but requires tool-use support in the backend.

**Recommended: Option A for v1, Option C as stretch goal.**

Option A is simple:

```typescript
// ChatPanel.tsx
const [codeContextLoaded, setCodeContextLoaded] = useState(false)

// When user clicks "Load code context":
const codeContext = await fetch('/api/build/read-files', {
  method: 'POST',
  body: JSON.stringify({ nodeId: selectedNodeId, workDir: config.workDir })
}).then(r => r.json())

// Add to chat request
body: JSON.stringify({
  message: trimmedMessage,
  history: nextHistory,
  nodeContext,
  codeContext: codeContext.content,  // NEW
  architecture_yaml: canvasToYaml(nodes, edges, projectName),
  ...
})
```

---

## Design: Build History as Context

### What to persist

Don't persist raw `buildOutputLog` on the node -- it's too large (10k+ tokens easily) and mostly noise. Instead, persist a digest:

```typescript
interface BuildAttempt {
  builtAt: number
  status: 'done' | 'error'
  durationMs: number
  backend: AgentBackendType
  model?: string
  summaryDigest: string         // 1-2 sentences: "Built successfully with 5 files. Used Express + Prisma."
  errorDigest?: string          // If failed: "Failed: Cannot find module 'pg'. Missing PostgreSQL driver."
  filesCreated?: string[]       // Only for successful builds
}
```

The `buildHistory` array on `BlockNodeData` keeps the last 3-5 attempts. This lets Chat say things like:

> "This node failed its first build attempt due to a missing PostgreSQL driver. The second attempt succeeded after switching to SQLite."

### What Chat should know about build history

Not the raw output. The digest. Inject it like this:

```typescript
// In buildNodeContext():
if (selectedNode.data.buildHistory?.length) {
  sections.push('')
  sections.push('## Build History')
  selectedNode.data.buildHistory.forEach((attempt, i) => {
    const time = new Date(attempt.builtAt).toISOString()
    const status = attempt.status === 'done' ? 'SUCCESS' : 'FAILED'
    sections.push(`${i + 1}. [${status}] ${time} (${(attempt.durationMs/1000).toFixed(0)}s) — ${attempt.summaryDigest}`)
    if (attempt.errorDigest) {
      sections.push(`   Error: ${attempt.errorDigest}`)
    }
  })
}
```

### Error persistence

Currently, `errorMessage` on `BlockNodeData` is set during build but there's no structured error that persists. When a build fails:

1. Set `node.data.errorMessage` (already happens)
2. Add to `buildHistory` with the error digest
3. On rebuild, DON'T clear the history -- append

This way Chat knows: "This node has been rebuilt 3 times. The first two failed because of X. The third succeeded."

---

## Design: The Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BUILD PHASE                               │
│                                                                  │
│  AgentRunner.spawnAgent(nodeId, prompt, backend, workDir)        │
│       │                                                          │
│       ├──► stdout → buildOutputLog[nodeId]  (existing, raw)      │
│       │                                                          │
│       └──► on('done') ─────────────────────────────┐             │
│                                                     │             │
│            ┌────────────────────────────────────────▼──────────┐ │
│            │          BUILD SUMMARY EXTRACTOR                  │ │
│            │                                                    │ │
│            │  1. scanWorkDir() → filesCreated, dependencies    │ │
│            │  2. parseOutput() → warnings, more files/deps     │ │
│            │  3. mergeSummary() → BuildSummary object           │ │
│            │  4. digestForHistory() → 1-sentence string         │ │
│            │                                                    │ │
│            └──────────────────────┬─────────────────────────────┘ │
│                                   │                               │
│            SSE event: { type: 'build-summary', nodeId, summary } │
│                                   │                               │
└───────────────────────────────────┼───────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                     CLIENT STATE UPDATE                           │
│                                                                   │
│  useAgentStatus.ts receives 'build-summary' event                │
│       │                                                           │
│       ├──► store.updateNodeData(nodeId, {                        │
│       │      buildSummary: summary,                               │
│       │      buildHistory: [...existing, newAttempt]              │
│       │    })                                                     │
│       │                                                           │
│       └──► Node data now enriched with build results             │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                        CHAT PHASE                                 │
│                                                                   │
│  User selects built node, opens chat                             │
│       │                                                           │
│       ▼                                                           │
│  buildNodeContext(nodeId, nodes, edges)                           │
│       │                                                           │
│       ├── name, description, status, techStack (existing)        │
│       ├── connected edges (existing)                             │
│       ├── buildSummary: files, deps, decisions, warnings (NEW)   │
│       ├── buildHistory: previous attempts digest (NEW)           │
│       └── errorMessage if status='error' (existing, now richer)  │
│       │                                                           │
│       ▼                                                           │
│  buildPrompt() assembles full context:                           │
│       │                                                           │
│       ├── L0: Language directive                                 │
│       ├── L1: Identity/persona                                   │
│       ├── L2: Conversation history                               │
│       ├── L3: Canvas state (YAML + enriched node context) ◄─NEW  │
│       ├── L4-5: Task + Skills                                    │
│       ├── L6: Constraints                                        │
│       └── L7: Output format                                      │
│       │                                                           │
│       ▼                                                           │
│  Chat agent now knows what was built, how, and what went wrong   │
│                                                                   │
│  Optional: user clicks "Load code context"                       │
│       │                                                           │
│       ▼                                                           │
│  /api/build/read-files → reads priority files from workDir       │
│  Injected as codeContext in chat request                         │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Edge Cases

### Multiple build iterations (build → chat → modify → rebuild)

When the user rebuilds a node:
1. Current `buildSummary` is replaced with the new one
2. Previous attempt is pushed to `buildHistory` (keep last 5)
3. Chat sees both: current state (buildSummary) and history (buildHistory)

```typescript
// On rebuild:
const previousSummary = node.data.buildSummary
if (previousSummary) {
  const history = node.data.buildHistory ?? []
  history.push({
    builtAt: previousSummary.builtAt,
    status: 'done',
    durationMs: previousSummary.durationMs,
    backend: previousSummary.backend,
    summaryDigest: `${previousSummary.filesCreated.length} files, deps: ${previousSummary.dependencies.slice(0, 3).join(', ')}`,
  })
  // Keep last 5
  node.data.buildHistory = history.slice(-5)
}
```

### Partial builds (some nodes done, some failed, some not built)

Chat already sees `node.data.status` for each node. With build summaries:
- `status: 'done'` + `buildSummary` present → fully informed
- `status: 'error'` + `errorMessage` + `buildHistory` → Chat can discuss the failure
- `status: 'idle'` + no `buildSummary` → Chat knows this wasn't built yet
- `status: 'blocked'` → Chat can explain why (upstream dependency failed)

For global chat (no node selected), inject a build status overview into the YAML context:

```typescript
// In canvasToYaml or as separate section:
function buildStatusOverview(nodes: CanvasNode[]): string {
  const blocks = nodes.filter(n => n.type === 'block')
  const done = blocks.filter(n => n.data.status === 'done')
  const failed = blocks.filter(n => n.data.status === 'error')
  const idle = blocks.filter(n => n.data.status === 'idle')

  return [
    `Build status: ${done.length}/${blocks.length} built, ${failed.length} failed, ${idle.length} pending`,
    ...failed.map(n => `  FAILED: ${n.data.name} — ${n.data.errorMessage?.slice(0, 100)}`),
  ].join('\n')
}
```

### Build output is huge (10k+ tokens)

This is why we DON'T inject raw `buildOutputLog` into chat context. Instead:
- `BuildSummary` is fixed-size (~200-500 tokens regardless of build output size)
- `buildHistory` entries are 1-2 sentences each (~50 tokens)
- `codeContext` (on-demand file reading) has a hard token budget (4000 default)
- Raw output stays in `buildOutputLog` store for the build drawer UI only

Total additional context per node: ~500 tokens (summary) + ~250 tokens (history) = ~750 tokens. Affordable.

### Node renaming or deletion after build

If a node is renamed, `buildSummary` stays (it's on the node data). If deleted, it's gone with the node. No orphaned data to clean up.

### workDir shared across nodes

In Build All, all nodes share the same `workDir`. File attribution becomes ambiguous -- Strategy 1 (directory scan) can't tell which node created which file unless we use the workDir diffing approach per-node:

```typescript
// In buildAll flow:
for (const nodeId of wave) {
  const beforeFiles = await snapshotWorkDir(workDir)
  const agentId = spawnAgent(nodeId, ...)
  await waitForAgent(agentId)
  const afterFiles = await snapshotWorkDir(workDir)
  const nodeFiles = diff(beforeFiles, afterFiles)
  // Attach nodeFiles to this node's buildSummary
}
```

Since `buildAll` already processes waves sequentially (parallel within a wave, sequential across waves), and within a wave nodes are independent, this diffing approach is reliable.

For parallel nodes within a wave: each agent runs simultaneously, so we can't attribute files per-node by diffing. Options:
1. Diff the entire wave, then distribute files by heuristic (filename contains node name)
2. Accept wave-level granularity: `filesCreated` lists all files from the wave
3. Create subdirectories per node in the build prompt (enforceable)

**Recommendation: Option 3.** Add to the build prompt: "Create all files under a `{node-name}/` subdirectory within the working directory." This is a prompt convention, not a guarantee, but build agents generally follow explicit directory instructions.

---

## Implementation Plan (Priority Order)

### P0: BuildSummary on node data (the core feedback loop)

**Files to modify:**
- `src/lib/types.ts` — Add `BuildSummary` and `BuildAttempt` interfaces, add fields to `BlockNodeData`
- `src/lib/build-summarizer.ts` — NEW: extraction logic (scan + parse)
- `src/app/api/agent/stream/route.ts` (or equivalent SSE handler) — Emit `build-summary` events after agent completes
- `src/hooks/useAgentStatus.ts` — Handle `build-summary` event type
- `src/components/ChatPanel.tsx` — Enrich `buildNodeContext()` with buildSummary

**Estimated effort:** 4-6 hours. Mostly plumbing, no new UI.

### P1: Build history persistence

**Files to modify:**
- `src/hooks/useAgentStatus.ts` — On rebuild, rotate current summary into history
- `src/components/ChatPanel.tsx` — Include history in node context

**Estimated effort:** 1-2 hours. Straightforward data rotation.

### P2: On-demand code reading

**Files to modify:**
- `src/app/api/build/read-files/route.ts` — NEW: endpoint to read files from workDir
- `src/components/ChatPanel.tsx` — "Load code context" button + codeContext in request
- `src/app/api/chat/route.ts` — Accept and inject `codeContext` into prompt

**Estimated effort:** 3-4 hours. New endpoint + UI button + prompt injection.

### P3: Global build status overview

**Files to modify:**
- `src/components/ChatPanel.tsx` — When no node selected, include build status overview

**Estimated effort:** 1 hour. One function, one injection point.

### P4 (stretch): LLM-based summary enrichment

**Files to modify:**
- `src/lib/build-summarizer.ts` — Add `llmSummarize()` with configurable enablement

**Estimated effort:** 2-3 hours. Needs a cheap LLM call utility.

---

## Why This Is Interview-Worthy

This feature demonstrates:

1. **System design thinking** — Identified a real knowledge gap between two agents in a multi-agent system and designed a structured feedback loop
2. **Token budget awareness** — Didn't just dump raw output into context. Designed a fixed-size summary format with on-demand expansion
3. **Data modeling** — BuildSummary is a well-structured interface that balances informativeness with compactness
4. **Layered extraction** — Three strategies (deterministic scan, regex parse, LLM summarize) with clear tradeoffs
5. **Fits existing architecture** — No new stores, no new agent types, no architectural rewrites. Just enriched node data flowing through existing channels
6. **Edge case handling** — Partial builds, rebuilds, shared workDir, token limits

The narrative:

> "After a Build agent generates code, a summarizer extracts structured metadata -- files created, dependencies installed, key implementation decisions -- and attaches it to the node. When the user switches to Chat, this build context flows into the conversation automatically through the existing context stack. The Chat agent now knows not just what the architecture DESCRIBES, but what was actually BUILT. For deeper questions, there's an on-demand code reading feature with token budget management. Build history persists across iterations so the Chat agent can reference previous attempts and failures."

---

## Open Questions

1. **Should buildSummary persist across project save/load?** Yes -- it's on `BlockNodeData` which is already serialized with the canvas. But it means save files get larger. With 20 nodes at ~500 tokens each, that's ~10k tokens of build metadata. Acceptable.

2. **Should Chat be able to trigger rebuilds?** This crosses the trust boundary (Chat is read-only, Build has write access). If we want this, it should be a canvas-action that the user confirms, not a direct rebuild. Defer to future iteration.

3. **What about multi-file projects where nodes share code?** E.g., a shared `utils/` directory. The summary might show `utils/helpers.ts` in multiple nodes' `filesCreated`. This is fine -- it's accurate. The Chat agent can see the overlap and discuss it.

4. **Should we version buildSummary?** If the schema changes, old save files might have an outdated format. Add a `version: 1` field to BuildSummary and handle migration on load. Low priority but good practice.
