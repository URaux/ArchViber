# Multi-Agent Architecture Brainstorm

> Thinking document. Not a plan. Not code. A first-principles argument for how agents should work in Vibe Pencil.

---

## The Problem Statement

The current system has 4 "agent roles" (`chat | import | build | title-gen`) implemented as persona strings in `context-engine.ts`. The SKILL-SYSTEM-PLAN.md proposes 3 "agent levels" (`project | module | build`). These two taxonomies don't align, creating conceptual debt before the skill system is even built.

The user's insight: **"chat, import, and title-gen should be the same agent doing different things."**

This is correct. But the reasoning matters more than the conclusion.

---

## First Principles: What Is an Agent?

An agent is not a persona string. An agent is a **runtime with capabilities**.

Three properties define whether something is a distinct agent:

| Property | Question |
|----------|----------|
| **Trust boundary** | Can it modify the filesystem? Which files? |
| **Execution model** | Does it run in-process (API route) or as a spawned subprocess? |
| **Output contract** | What shape does its output take? (text, JSON, files-on-disk) |

Applying this test:

| Current "Role" | Trust | Execution | Output | Verdict |
|----------------|-------|-----------|--------|---------|
| **chat** | Read-only (canvas actions are suggestions, not writes) | Spawned subprocess, SSE streamed | Markdown + optional `json:canvas-action` blocks | **Agent** |
| **import** | Reads filesystem (the project dir), no writes | Spawned subprocess, awaited | Structured JSON (containers, blocks, edges) | Same agent as chat, different task |
| **build** | Full write access to `workDir` | Spawned subprocess per node | Files on disk | **Distinct agent** |
| **title-gen** | None | Should be a single API call, not a subprocess | Plain text string | **Not an agent. A function.** |

### Observation 1: Import is just Chat with a different output format

Look at what import actually does:
1. Gets a system prompt from `buildSystemContext({ role: 'import' })`
2. Spawns `claude -p` with that prompt
3. Waits for completion
4. Parses JSON from the output

Chat does the same thing, minus the JSON parsing, plus SSE streaming.

The difference is not in the agent. It's in the **task definition** (prompt) and the **output handler** (JSON extraction vs streaming). The subprocess is identical: `claude -p`.

### Observation 2: Title-gen should not spawn a process at all

Title generation is a 10-token output from a single prompt. Spawning a Claude Code subprocess (with its startup cost, MCP initialization, etc.) for this is absurd. This should be a direct LLM API call or, at minimum, a lightweight function -- not an "agent role."

### Observation 3: Build is fundamentally different

Build agents write files. They have filesystem side effects. They run in parallel. They need isolated working directories. They have a different trust level (full write access within scope). This is the only real agent boundary.

---

## Proposed Architecture: 2 Agents, N Tasks

```
┌─────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                          │
│         (Next.js server, not an "agent")                │
│                                                         │
│  Responsibilities:                                      │
│  - Context assembly (system prompt construction)        │
│  - Task routing (which agent type, which skills)        │
│  - Output parsing (JSON extraction, action parsing)     │
│  - State management (canvas, sessions, build waves)     │
│                                                         │
│  Functions (not agents):                                │
│  - title-gen: single LLM call, returns string           │
│  - canvas-action parsing: regex/parser, no LLM needed   │
│                                                         │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  ┌───────────▼───────────┐  ┌────────────────────────┐ │
│  │   CANVAS AGENT        │  │   BUILD AGENT          │ │
│  │   (1 instance)        │  │   (N instances)        │ │
│  │                       │  │                        │ │
│  │ Trust: read-only      │  │ Trust: write to workDir│ │
│  │ Exec: spawned process │  │ Exec: spawned process  │ │
│  │ Output: text stream   │  │ Output: files on disk  │ │
│  │                       │  │                        │ │
│  │ Tasks:                │  │ Tasks:                 │ │
│  │ - Discuss (chat)      │  │ - Implement node       │ │
│  │ - Import (analyze)    │  │ - Refactor node        │ │
│  │ - Suggest (canvas)    │  │                        │ │
│  │ - Analyze (review)    │  │ Skills:                │ │
│  │                       │  │ - core/*               │ │
│  │ Skills:               │  │ - techStack-matched    │ │
│  │ - core/*              │  │ - testing/*            │ │
│  │ - architect/*         │  │ - build/*              │ │
│  │ - (task-specific)     │  │ - container-inherited  │ │
│  └───────────────────────┘  └────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Why 2, not 3?

The SKILL-SYSTEM-PLAN.md proposes `project | module | build`. But "project" vs "module" is not an agent boundary -- it's a **scope parameter**.

- "Project scope" = canvas agent sees the full architecture YAML, no node selected
- "Module scope" = canvas agent sees full YAML but is focused on a specific node

The agent is the same. The context changes. The skill loading changes. But you don't need a different process, different trust level, or different output format.

The distinction that matters is read-only (canvas agent) vs read-write (build agent).

### Why not 1?

You could argue: "build is just chat with write permissions." Technically true. But collapsing this boundary creates a dangerous ambiguity. When a user chats about architecture, the agent should NEVER modify files. When it builds, it MUST modify files. This is a trust boundary, and trust boundaries should be hard, not soft.

Also: build agents run as parallel subprocesses with isolated working dirs. Chat runs as a single process with SSE streaming. The execution model is architecturally different.

---

## Context Assembly: The Real Architecture

If we have only 2 agent types, the interesting question becomes: how is context assembled? This is where the real engineering lives.

### Context Stack Model

Every agent invocation assembles a context stack. Each layer is independent and composable:

```
┌─────────────────────────────────────┐
│ Layer 7: Output Format              │  ← "Return JSON matching this schema" / "Stream markdown"
├─────────────────────────────────────┤
│ Layer 6: Constraints                │  ← "Do NOT modify files" / "Only edit within workDir"
├─────────────────────────────────────┤
│ Layer 5: Skills (domain knowledge)  │  ← Loaded from skills/, matched by techStack + level
├─────────────────────────────────────┤
│ Layer 4: Task Definition            │  ← "Analyze this codebase" / "Implement this node"
├─────────────────────────────────────┤
│ Layer 3: Canvas State               │  ← Architecture YAML, selected node, edges
├─────────────────────────────────────┤
│ Layer 2: Conversation History       │  ← Prior messages (chat only)
├─────────────────────────────────────┤
│ Layer 1: Identity                   │  ← "You are the AI assistant for Vibe Pencil"
├─────────────────────────────────────┤
│ Layer 0: Language                   │  ← "Respond in Chinese" / "Respond in English"
└─────────────────────────────────────┘
```

The current `context-engine.ts` conflates layers 1, 4, 5, and 6 into a single `PERSONAS` lookup. The refactored version should assemble each layer independently.

### Context Assembly Per Task

| Task | L0 | L1 | L2 | L3 | L4 | L5 | L6 | L7 |
|------|----|----|----|----|----|----|----|----|
| **Chat (global)** | locale | identity | history | full YAML | "discuss architecture" | core + architect | read-only, canvas-actions allowed | markdown + json:canvas-action |
| **Chat (node)** | locale | identity | history | full YAML + selected node | "discuss this component" | core + techStack-matched | read-only, canvas-actions allowed | markdown + json:canvas-action |
| **Import** | locale | identity | none | none (no canvas yet) | "reverse-engineer codebase at {dir}" | core + architect | read-only, structured output only | JSON (containers/blocks/edges schema) |
| **Build node** | locale | identity | none | full YAML + target node | "implement {node} in {workDir}" | core + techStack-matched + testing | write within workDir only | files on disk |
| **Build All** | locale | identity | none | full YAML + wave plan | "implement {node}, wave {n}/{total}" | core + techStack-matched + testing + build | write within workDir only | files on disk |
| **Title-gen** | none | none | none | none | "summarize in 5 words" | none | none | plain string |

Notice: title-gen doesn't even need layers 0-3. It's not an agent task. It's a pure function.

### What Changes in `context-engine.ts`

Replace `AgentRole = 'chat' | 'import' | 'build' | 'title-gen'` with:

```
AgentType = 'canvas' | 'build'

TaskType = 'discuss' | 'discuss-node' | 'import' | 'analyze'
         | 'implement' | 'refactor'

ContextOptions = {
  agentType: AgentType
  task: TaskType
  locale: Locale
  skills: string[]           // pre-resolved skill content
  canvasYaml?: string        // layer 3
  selectedNodeId?: string    // layer 3
  conversationHistory?: Message[]  // layer 2
  taskParams?: Record<string, string>  // layer 4 extras (dir, workDir, etc.)
}
```

The `buildSystemContext` function becomes a stack assembler, not a persona lookup.

---

## How Skills Map to This

The SKILL-SYSTEM-PLAN.md's 3 levels (`project | module | build`) map cleanly:

| Skill Level | Maps To |
|-------------|---------|
| `project` | Canvas agent, global scope tasks (discuss, import, analyze) |
| `module` | Canvas agent, node scope tasks (discuss-node) AND build agent |
| `build` | Build agent only (output format, file structure constraints) |

The skill resolver doesn't need to know about agent levels. It needs to know:
1. **Agent type** (canvas or build) -- determines trust-level constraints
2. **Scope** (global or node) -- determines whether to match techStack
3. **Task** (discuss, import, implement) -- determines task-specific skills

```
resolveSkills(agentType, scope, task, node?) → Skill[]
```

This is simpler than the SKILL-SYSTEM-PLAN's `resolveSkillsForAgent(level, node)` because it separates the dimensions that are actually orthogonal.

---

## What SKILL-SYSTEM-PLAN.md Needs to Change

### Keep
- Skill file format (frontmatter + markdown body) -- good
- 3 sources (local, github, team) -- good
- Category-based organization (core, architect, frontend, backend, testing) -- good
- Priority-based dedup -- good
- Cold/hot loading -- good
- UI management panel -- good (P1)
- Build-time skill preview -- good

### Change

1. **Rename `level` field in frontmatter.** Instead of `level: [project]`, use `scope: [global]` or `scope: [node]` or `scope: [build]`. The word "level" implies hierarchy when the real distinction is scope.

2. **Drop the "Project Agent" / "Module Agent" / "Build Agent" narrative.** Replace with "Canvas Agent (global scope)" / "Canvas Agent (node scope)" / "Build Agent." Two agents, not three.

3. **The AgentRegistry in section 6 is overengineered for the current state.** A canvas agent is a single process. Build agents are tracked by `AgentRunner`. The registry adds a layer of abstraction over something that already works. Defer until there's a real need (e.g., multiple concurrent canvas agents, agent-to-agent communication).

4. **The agent panel UI (section 6.2) conflates monitoring with architecture.** The build drawer already shows wave progress and node status. A separate "agent panel" that duplicates this information with a different hierarchy is UI clutter, not architecture. The build drawer IS the monitoring surface for build agents. Chat has its own sidebar. No third panel needed.

---

## The Orchestrator Pattern

The most important architectural insight: **the Next.js server is the orchestrator, not an agent.**

Current code already does this but doesn't name it:
- `route.ts` (chat) assembles the prompt, spawns the agent, streams results
- `route.ts` (import) assembles the prompt, spawns the agent, parses JSON
- `useBuildActions.ts` computes wave plan, assembles prompts, calls spawn API

This is orchestration. Naming it makes it defensible in an interview:

> "The system has an orchestrator and two agent types. The orchestrator -- the Next.js server -- handles context assembly, task routing, and output parsing. It's not an agent because it doesn't use an LLM for its own decisions. It assembles context stacks for agents based on the task type, scope, and loaded skills. Canvas agents are read-only -- they discuss, analyze, and suggest canvas modifications. Build agents have filesystem write access and run in parallel with wave scheduling."

---

## ASCII Architecture Diagram

```
User clicks "Chat"        User clicks "Import"       User clicks "Build All"
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR                                 │
│                    (Next.js API Routes)                               │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │              CONTEXT ASSEMBLER                           │        │
│  │                                                          │        │
│  │  Input:  agentType + task + scope + node + skills        │        │
│  │  Output: fully assembled system prompt                   │        │
│  │                                                          │        │
│  │  ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────┐ ┌────────┐ │        │
│  │  │Identity│ │Language│ │  Task   │ │Skills│ │Constr. │ │        │
│  │  │ Layer  │ │ Layer  │ │  Layer  │ │Layer │ │ Layer  │ │        │
│  │  └────────┘ └────────┘ └─────────┘ └──────┘ └────────┘ │        │
│  └──────────────────────────────────────────────────────────┘        │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────────────────────┐         │
│  │   SKILL RESOLVER  │  │         TASK ROUTER              │         │
│  │                    │  │                                  │         │
│  │  scope + techStack │  │  task type → agent type          │         │
│  │  → matched skills  │  │  + output handler                │         │
│  └──────────────────┘  └──────────────────────────────────┘         │
│                                                                      │
│  ┌──────────────────────────────────┐                                │
│  │       UTILITY FUNCTIONS           │                                │
│  │  - title-gen (single LLM call)    │                                │
│  │  - canvas-action parser           │                                │
│  │  - YAML serializer                │                                │
│  └──────────────────────────────────┘                                │
│                                                                      │
├──────────────────────────┬───────────────────────────────────────────┤
│                          │                                           │
│  ┌───────────────────┐   │   ┌────────────────────────────────────┐  │
│  │   CANVAS AGENT    │   │   │         BUILD AGENT POOL           │  │
│  │   (subprocess)    │   │   │                                    │  │
│  │                   │   │   │   Wave 0:                          │  │
│  │ Trust: read-only  │   │   │   ┌──────┐ ┌──────┐ ┌──────┐     │  │
│  │ Output: stream    │   │   │   │node-A│ │node-B│ │node-C│     │  │
│  │                   │   │   │   └──┬───┘ └──┬───┘ └──┬───┘     │  │
│  │ Tasks:            │   │   │      │ done    │ done   │ done    │  │
│  │ ● discuss         │   │   │      ▼         ▼        ▼         │  │
│  │ ● import          │   │   │   Wave 1:                          │  │
│  │ ● analyze         │   │   │   ┌──────┐ ┌──────┐              │  │
│  │ ● suggest         │   │   │   │node-D│ │node-E│              │  │
│  │                   │   │   │   └──────┘ └──────┘              │  │
│  └───────────────────┘   │   │                                    │  │
│                          │   │ Trust: write within workDir        │  │
│                          │   │ Output: files on disk              │  │
│                          │   │ Concurrency: config.maxParallel    │  │
│                          │   └────────────────────────────────────┘  │
│                          │                                           │
└──────────────────────────┴───────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  skills/    │
                    │  ├ core/    │
                    │  ├ architect│
                    │  ├ frontend │
                    │  ├ backend  │
                    │  ├ testing  │
                    │  └ build    │  ← new: build-specific output constraints
                    └─────────────┘
```

---

## Anti-Patterns to Avoid

### 1. "Agent per feature" proliferation
**Wrong:** Adding a new agent type every time you add a feature (chat agent, import agent, analyze agent, refactor agent, title agent, summary agent...).
**Right:** Two agent types. New features are new tasks with different context stacks.

### 2. Persona-driven architecture
**Wrong:** Defining agents by their personality ("You are a collaborative assistant" vs "You are a reverse-engineer"). Personas are cosmetic. They don't affect capability boundaries.
**Right:** Define agents by trust boundaries and execution models. The persona is a single line in the identity layer, not an architectural decision.

### 3. Premature agent hierarchy
**Wrong:** Building a `ProjectManager → ModuleAssistant → BuildWorker` hierarchy where the project manager "coordinates" module assistants. This is LLM-calling-LLM overhead with no clear benefit.
**Right:** The orchestrator (deterministic code) coordinates everything. Agents are leaves, not nodes in a tree. If you need inter-agent coordination, the orchestrator handles it with deterministic logic (topo sort, wave scheduling), not LLM reasoning.

### 4. Agent identity confusion in the UI
**Wrong:** Showing the user "Project Manager Agent is thinking..." when they're just chatting. The user doesn't care about agent taxonomy. They care about getting an answer.
**Right:** "Chat" is chat. "Build" is build. "Import" is import. The internal architecture should be clean, but the user-facing labels should match user intent, not system internals.

### 5. Over-abstracting the AgentRegistry
**Wrong:** Building a full registry with parent-child relationships, agent lifecycle management, and inter-agent messaging before you have a use case for any of it.
**Right:** `AgentRunner` already tracks spawned processes. The build drawer already shows status. Add registry infrastructure when you need agent-to-agent communication or persistent agent state -- not before.

### 6. Skills as agent differentiation
**Wrong:** "The project agent loads architect skills, so it IS the architect." Skills are injected knowledge, not identity. The same agent with different skills is the same agent doing a different job.
**Right:** Skills are a context layer. They're resolved by the orchestrator based on task + scope + techStack, not by the agent itself. The agent doesn't "choose" its skills.

### 7. Conflating "scope" with "agent level"
**Wrong:** `level: 'project'` means a different agent than `level: 'module'`. Now you have 3 agent classes to maintain.
**Right:** There's one canvas agent. When it handles a global question, it gets project-scope context. When it handles a node question, it gets node-scope context. Same agent, different context stack.

---

## Interview Narrative

> "Vibe Pencil uses a 2-agent architecture with an orchestrator pattern. The orchestrator is deterministic Next.js server code that handles context assembly, skill resolution, and task routing. It doesn't use LLMs for its own decisions.
>
> There are exactly two agent types, separated by trust boundary. Canvas agents are read-only -- they discuss architecture, analyze codebases, and suggest canvas modifications via structured JSON actions. Build agents have filesystem write access and run as parallel subprocesses with wave-based scheduling respecting dependency order.
>
> The key insight is that 'import a project' and 'discuss architecture' are not different agents -- they're different tasks for the same agent, with different context stacks and output handlers. The context stack is a 7-layer composition: language, identity, conversation history, canvas state, task definition, domain skills, constraints, and output format. Skills are markdown instruction files resolved by the orchestrator based on task scope and the node's tech stack, not by the agent itself.
>
> This avoids the common anti-pattern of 'agent per feature' proliferation, where you end up with 6 agent types that are really just 6 different prompts to the same underlying process."

---

## Open Questions

1. **Should import become synchronous-streaming instead of await-then-parse?** Currently import spawns an agent and polls until completion. If it used SSE streaming like chat, the user could see progress. The output handler would need to buffer and parse JSON from the stream. Worth doing, but not an agent architecture question.

2. **Where does "analyze project" live?** The `prompt-templates.ts` has `analyzeProject` and `refactorNode` functions. These are canvas agent tasks (read-only, text output). They should use the same canvas agent with different task context.

3. **Should Build agents read conversation history?** Currently they don't. But if the user discussed implementation details in chat before clicking "Build," that context is lost. The orchestrator could inject relevant chat history into the build prompt. This is a context assembly question, not an agent architecture question.

4. **When does the 2-agent model break?** When you need agents that communicate with each other in real time. Example: a "reviewer agent" that reads build output and suggests fixes. This would be a third trust level (read build output, suggest but not write). Cross that bridge when you get there.

5. **Title-gen implementation.** The cleanest approach: a utility function in the orchestrator that makes a direct API call to a cheap model (DeepSeek, Haiku, etc.) with a 3-line prompt. No subprocess, no agent runner, no streaming. Just `await llm.complete("Summarize this conversation in 5 words: ...")`.
