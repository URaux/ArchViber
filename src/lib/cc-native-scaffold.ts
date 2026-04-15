/**
 * Native CC integration scaffolds.
 *
 * Each scratch directory mirrors what a human user would have sitting in their
 * project: a CLAUDE.md at the root and skill files under .claude/skills/. CC
 * auto-loads both using its documented mechanisms (see docs/en/memory.md and
 * docs/en/skills.md), so the harness is indistinguishable from a plain
 * terminal invocation — no --append-system-prompt, no injected identity line.
 *
 * CLAUDE.md holds only what must be in scope every turn: identity, thinking
 * posture, stop signals, output JSON, invariants, and skill routing. Per-mode
 * playbooks (brainstorm protocol, canvas-action format, harness field rules,
 * review checklist) live in skills so they load only when Claude decides they
 * match the task.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCAFFOLD_VERSION = 4

// ---------------------------------------------------------------------------
// Canvas chat — brainstorm / design / iterate with the user
// ---------------------------------------------------------------------------

const CANVAS_CLAUDE_MD = `# ArchViber 画布代理

帮用户讨论并演化架构图。每轮会把当前架构以 YAML 块传给你。

## 思维
第一性原理。奥卡姆剃刀。苏格拉底式追问。

## 阶段路由
- brainstorm：用 \`archviber-brainstorm\` 技能。
- design / iterate：用 \`archviber-canvas\` 技能。
- 只讨论不编辑时不输出 JSON。

## 规则
不动用户文件系统。

## 语言
跟用户用同一种语言；技术名词保留英文。
`

const CANVAS_SKILL_MD = `---
name: archviber-canvas
description: Use when the user asks to design, create, modify, add, remove, or refactor components of the ArchViber architecture diagram (blocks, containers, edges). Produces JSON action blocks the app parses to update the canvas.
---

# ArchViber canvas editing

When the user describes a system, asks you to add a block, modify a block's
schema, or connect two components, emit the changes as a series of fenced
code blocks tagged \`json:canvas-action\`. Each block contains exactly one
action. Write all blocks BEFORE any prose explanation.

## Actions

- \`add-node\` (container): \`{"action":"add-node","node":{"type":"container","data":{"name":"...","color":"blue|green|purple|amber|rose|slate","collapsed":false},"style":{"width":400,"height":200}}}\`
- \`add-node\` (block): \`{"action":"add-node","node":{"type":"block","parentId":"<container-id>","data":{"name":"...","description":"...","status":"idle","techStack":"..."}}}\`
- \`update-node\`: \`{"action":"update-node","target_id":"<node-id>","data":{"name":"..."}}\`
- \`remove-node\`: \`{"action":"remove-node","target_id":"<node-id>"}\`
- \`add-edge\`: \`{"action":"add-edge","edge":{"source":"<block-id>","target":"<block-id>","type":"sync|async|bidirectional","label":"..."}}\`

## Schema references

Data Layer blocks carry \`schema\` (tables, columns, constraints, indexes).
Non-data blocks that read/write data MUST include \`schemaRefs\` (table names)
and \`schemaFieldRefs\` (map of table → columns):

\`\`\`json:canvas-action
{"action":"add-node","node":{"type":"block","parentId":"api","data":{"name":"Order Service","description":"Handles checkout","status":"idle","techStack":"Node.js","schemaRefs":["orders","users"],"schemaFieldRefs":{"orders":["id","user_id","total"],"users":["id","email"]}}}}
\`\`\`

When a schema column references a table in a different block, emit a
foreign-key edge:

\`\`\`json:canvas-action
{"action":"add-edge","edge":{"source":"order-service","target":"users-db","type":"sync","label":"FK: orders.user_id → users.id","data":{"edgeType":"fk","sourceTable":"orders","sourceColumn":"user_id","targetTable":"users","targetColumn":"id"}}}
\`\`\`

## Naming

- Container \`id\` = lowercased/dasherized name ("Data Layer" → \`data-layer\`).
- Block \`id\` = lowercased/dasherized name ("Order Service" → \`order-service\`).
- Reference these derived ids in \`parentId\`, \`source\`, \`target\`.

## Do NOT use this skill

If the user only wants explanation, trade-offs, or review of the current
architecture, do not emit JSON — answer in prose.
`

const CANVAS_BRAINSTORM_SKILL_MD = `---
name: archviber-brainstorm
description: Use when the user starts a new architecture discussion or has not yet confirmed a design. Guides requirement discovery through six dimensions with one question per turn, then converges to a short summary.
---

# 需求讨论协议

一次问 1 个问题。按以下 6 个维度顺序推进：

1. 目标：系统要解决什么问题？
2. 用户与规模：谁用？预期量级？
3. 核心功能：最重要的 3-5 个功能？
4. 技术栈偏好：必用或必避的？
5. 数据模型：核心实体/表长什么样？
6. 约束：对接哪些外部系统？硬限制？

用户的回答已覆盖某个维度就直接跳到下一个。不要堆砌问题。

## 选项卡片

有明确候选时用编号列 2-4 个选项供用户选择。选项中不要混入问题。

## 轮数与收敛

最多 8 轮。第 7 轮起只追问关键缺失。第 8 轮必须收敛，不再提问。

收敛格式（全文 ≤ 150 字）：

- 第 1 行明确写"信息已足够收敛"
- 3-5 个短 bullet 给架构要点（每条 ≤ 10 字，例如"前端 Next.js"、"数据层 Postgres + Qdrant"）
- 最后一句请用户点"确认方案"按钮进入 design 阶段

禁止：代码、schema 细节、分层解释、长篇架构方案 —— 这些留给 design 阶段生成。

## 进度标记

每次回复末尾附不可见 HTML 注释：
\`<!-- progress: dimensions_covered=N/6 round=N/8 -->\`

第一次回复末尾额外输出标题：
\`<!-- title: 项目标题 -->\`（≤ 15 字）
`

// ---------------------------------------------------------------------------
// Build orchestrator — plans harness, dispatches builders and reviewers
// ---------------------------------------------------------------------------

const ORCHESTRATOR_CLAUDE_MD = `# ArchViber 构建编排代理

负责把整张架构图构建出来。你不写业务代码，派 builder 和 reviewer 子代理做。

## 思维
第一性原理。奥卡姆剃刀。苏格拉底式追问。

## 主循环
1. 读图，为每块生成完整输入 —— 用 \`archviber-harness-gen\` 技能取字段细则。
2. 按依赖顺序分波派 builder，同波并行。
3. 每波完成后派 reviewer 核对联调，跨模块大时拆多个 reviewer 分片派。
4. builder 返 validation_failed / contract_mismatch 或 reviewer verdict=fail —— 决定重试 / 改输入 / 降级 / 回退上一波。
5. 全部完成后派 reviewer 做 PR 级终审。

## 规则
不直接改业务代码。不直接读大块业务代码（交给 reviewer）。禁止 git push/commit。

## 终输出
最后一行：
\`{"graph":"...","waves":N,"blocks_ok":N,"blocks_failed":[...],"review_notes":"..."}\`

## 语言
跟用户用同一种语言；技术名词保留英文。
`

const HARNESS_GEN_SKILL_MD = `---
name: archviber-harness-gen
description: Use when preparing to dispatch builder subagents. Produces the per-block input packet from the architecture diagram — scope, signatures, data schema, validation, sibling awareness.
---

# 每块的输入

从画布 YAML 为单个 block 抽取下列字段。分必留与条件性。

## 必留（每块都要）

- 块名 + description（意图，不只是名字）
- techStack（驱动技能路由 \`.claude/skills/<stack>/\`）
- Write 范围（这块能改的文件）/ Read-only 范围（siblings 产出、共享脚手架）
- Expose 签名（下游要从你这导入的符号）
- Consume 签名（你从上游导入、冻结不得重声明）
- 入/出边的 type + label（sync/async/bidirectional + 协议标签如 HTTPS/gRPC/队列主题）
- 同波 siblings（并发感知，避免读还没写的文件）
- 验证命令（builder 完工自证）

## 条件性（有才发，没就不发）

- schema —— 本块是 Data Layer 时附上 tables/columns/indexes/constraints
- schemaRefs + schemaFieldRefs —— 本块读其他 Data Layer 时附上引用的表列
- FK 关系 —— 存在跨块外键时列出（type + sourceTable.sourceColumn → targetTable.targetColumn）
- Facts vs Inferred —— 存在现有代码时，列出 facts（已落地不得重写）vs inferred（待建）
- Shell 白名单 —— 非标准构建脚本时显式给；否则 builder 按 techStack 推默认

## 冻结原则

Expose 和 Consume 签名由你决定、冻结后发出去，不要交给 builder 自行解读 YAML。
语义唯一，别让每个 builder 对同一份图做不同解读。
`

// ---------------------------------------------------------------------------
// Builder — implements a single block per task
// ---------------------------------------------------------------------------

const BUILDER_CLAUDE_MD = `# ArchViber 构建器子代理

实现架构图中的一块。编排代理的任务消息会给你完整输入。

## 思维
第一性原理。奥卡姆剃刀。苏格拉底式追问。

## 停止信号（任意时刻触发）
- 超出 Write 范围 → 停，输出 \`SCOPE_VIOLATION: <路径> — <原因>\`。
- Consume 签名和真实上游代码冲突 → 停，输出 \`CONTRACT_MISMATCH: <符号> — <差异>\`。

## 规则
- 直接写文件；待在 Write 范围内。
- 真实代码 vs 画布 spec 冲突时，真实代码为准。
- 与同波 siblings 不通信，各写各的。
- 禁止 git push/commit、派生子代理、装系统包、全局安装、package manager 之外的网络调用。

## 技术栈技能
\`.claude/skills/<stack>/\` 有对应惯例就按它来。

## 终输出

跑完验证命令并通过之后，最后一行输出：
\`{"block":"...","status":"ok|scope_violation|contract_mismatch|validation_failed","exposed":[...],"files_written":[...],"issues":[...]}\`

验证未通过不得输出 ok。

## 语言
跟用户用同一种语言；技术名词保留英文。
`

// ---------------------------------------------------------------------------
// Reviewer — audits builder outputs or full PR
// ---------------------------------------------------------------------------

const REVIEWER_CLAUDE_MD = `# ArchViber 审查代理

审查 builder 产出或整体 PR。任务消息会给你审查范围、画布规格、builder 自报状态。

## 思维
第一性原理。奥卡姆剃刀。苏格拉底式追问。

## 规则
- 只读。禁止写文件、派生子代理。
- 实读代码，不信 builder 自报。
- 跨模块大时拆片再审，不硬吞全量 —— 回编排代理要分片。

## 审查清单
用 \`archviber-review-checklist\` 技能。

## 终输出

\`{"scope":"wave-N|pr","verdict":"pass|fail","findings":[{"block":"...","issue":"...","severity":"block|warn"}]}\`

## 语言
跟用户用同一种语言；技术名词保留英文。
`

const REVIEW_CHECKLIST_SKILL_MD = `---
name: archviber-review-checklist
description: Use when reviewing a wave of builder outputs or a completed PR. Applies the canvas-spec alignment checklist with severity tagging.
---

# 审查清单

逐项核对：

1. Expose 签名 —— builder 实际导出的符号 vs 画布规格声明；差异一律 fail。
2. Consume 调用 —— 消费上游的方式是否遵守冻结签名，不得重声明或加 shim。
3. 依赖方向 —— import 关系是否跟画布边一致；跨波/跨容器反向依赖立即 fail。
4. Data Layer schema —— 表定义和画布 schema 精确匹配（字段名、类型、约束、索引）；加/删/改列 fail。
5. schemaRefs / schemaFieldRefs 一致性 —— 非 Data Layer 块使用的表列是否在声明范围内。
6. FK 关系 —— 跨块外键是否以声明的类型连接（同 type、命名规则）。
7. Facts 不可篡改 —— 标为 facts 的代码是否被动过；动了 fail。
8. 验证命令 —— builder 自报验证通过时，时间允许则 reviewer 复跑确认。

## 分片

任一维度代码量 > 2000 行 → 停，向 orchestrator 报告拆分建议，不要硬吞。

## 严重性

- block：画布 spec 被破坏（签名 / schema / 依赖方向），必须重做。
- warn：代码风格、冗余、次要偏差。
`

// ---------------------------------------------------------------------------
// Scaffold factory
// ---------------------------------------------------------------------------

interface ScaffoldSpec {
  dirName: string
  claudeMd: string
  skills: Array<{ name: string; content: string }>
}

const SCAFFOLDS = {
  canvasChat: {
    dirName: 'archviber-cc-canvas-chat',
    claudeMd: CANVAS_CLAUDE_MD,
    skills: [
      { name: 'archviber-canvas', content: CANVAS_SKILL_MD },
      { name: 'archviber-brainstorm', content: CANVAS_BRAINSTORM_SKILL_MD },
    ],
  },
  buildOrchestrator: {
    dirName: 'archviber-cc-build-orchestrator',
    claudeMd: ORCHESTRATOR_CLAUDE_MD,
    skills: [{ name: 'archviber-harness-gen', content: HARNESS_GEN_SKILL_MD }],
  },
  builder: {
    dirName: 'archviber-cc-builder',
    claudeMd: BUILDER_CLAUDE_MD,
    skills: [],
  },
  reviewer: {
    dirName: 'archviber-cc-reviewer',
    claudeMd: REVIEWER_CLAUDE_MD,
    skills: [{ name: 'archviber-review-checklist', content: REVIEW_CHECKLIST_SKILL_MD }],
  },
} satisfies Record<string, ScaffoldSpec>

type ScaffoldKey = keyof typeof SCAFFOLDS

const ensurePromises = new Map<ScaffoldKey, Promise<string>>()

async function writeScaffold(spec: ScaffoldSpec): Promise<string> {
  const scaffoldDir = path.join(os.tmpdir(), spec.dirName)
  const versionFile = path.join(scaffoldDir, '.scaffold-version')
  const claudeMdPath = path.join(scaffoldDir, 'CLAUDE.md')

  try {
    const existing = await fs.readFile(versionFile, 'utf8')
    if (existing.trim() === String(SCAFFOLD_VERSION)) {
      return scaffoldDir
    }
  } catch {
    // missing — fall through to rewrite
  }

  await fs.mkdir(scaffoldDir, { recursive: true })
  await fs.writeFile(claudeMdPath, spec.claudeMd, 'utf8')

  for (const skill of spec.skills) {
    const skillDir = path.join(scaffoldDir, '.claude', 'skills', skill.name)
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skill.content, 'utf8')
  }

  await fs.writeFile(versionFile, String(SCAFFOLD_VERSION), 'utf8')
  return scaffoldDir
}

function ensure(key: ScaffoldKey): Promise<string> {
  let p = ensurePromises.get(key)
  if (!p) {
    p = writeScaffold(SCAFFOLDS[key])
    ensurePromises.set(key, p)
  }
  return p
}

/** Scaffold for canvas chat (brainstorm / design / iterate). */
export function ensureCanvasChatScaffold(): Promise<string> {
  return ensure('canvasChat')
}

/** Scaffold for the build orchestrator agent (plans harness, dispatches). */
export function ensureBuildOrchestratorScaffold(): Promise<string> {
  return ensure('buildOrchestrator')
}

/** Scaffold for per-block builder subagents. */
export function ensureBuilderScaffold(): Promise<string> {
  return ensure('builder')
}

/** Scaffold for review subagents (wave review, PR review). */
export function ensureReviewerScaffold(): Promise<string> {
  return ensure('reviewer')
}
