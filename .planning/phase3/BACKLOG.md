# Phase 3 — Backlog

This is the parking lot of items deferred out of Phase 2. Promote anything here to a real `.planning/phase3/PLAN.md` when starting P3.

## High-priority candidates (clear value, low risk)

### Modify v0.3: move + split + merge verbs
Phase 2 v0.2 shipped extract. Same plan/sandbox/PR scaffold; each verb needs its own AST manipulation pass.
- **move**: relocate a top-level decl to another file, fix imports
- **split**: split a large function into named helpers (extract × N)
- **merge**: opposite of split — fold a small helper back into its sole caller

Estimated: 3-4 days each, mechanical once the closure-detection patterns from W3.D6 are reused.

### Multi-language ingest expansion
Recipe doc (`docs/HOW-TO-ADD-A-LANGUAGE.md`) makes each new language ~1 day. Priority order based on resume / demo value:
1. C# (Java-ish modifiers)
2. Ruby (Python-ish dynamic)
3. C/C++ (Go-ish convention-based, plus #include parsing)
4. PHP (mixed)
5. Kotlin / Scala (Java-ish)
6. Swift (Rust-ish)
7. Lua / Zig / Nim / Elixir / Haskell — long tail

### Live-LLM eval cron
Current eval is MockRunner-only. Phase 2 PLAN.md §0 row 2 decided for a weekly real-LLM holdout.
- New `scripts/run-eval-live.mjs` that spawns a real classifier against a held-out fixture set
- Track results over time in a JSON log committed back to the repo
- Compare run-to-run for accuracy regression

### Persistent telemetry
Currently `getRecentTurns()` is an in-memory ring buffer. Default-on means we need queryable history.
- Stream every `recordClassification` / `recordDispatch` to `.archviber/cache/orchestrator-log.jsonl`
- Add a small viewer: `scripts/recent-turns.mjs` that prints the last N entries

### codex-rescue subagent wrapper bug
Stalled 5× across the session that produced this backlog. Direct invocation of `codex-companion.mjs` with `--model gpt-5.5` works. The `Agent(subagent_type='codex:codex-rescue')` route silently falls back to Sonnet. Investigation:
- Read the rescue subagent's spawn path
- Compare what it sends to Codex vs what works direct
- Probably either a model-list filter or a permissions handshake

## Medium-priority

### CRDT collaborative editing (Phase 2 W2 alternative path)
Yjs / Automerge document layer over IR; WebSocket sync; conflict-free save semantics. Big scope (≥ 2 weeks). Defer until there's a real multi-user driver.

### Architecture PR review bot
Separate from drift detection. Drift just compares IRs; review would also use the deep_analyze 5-perspective output as a PR comment. Pre-req: drift must be solid in production first.

### Build sandbox redesign
Today's build pipeline is regex-on-output. Sub-process isolation + selective retry would make build agents reliable. Useful when the orchestrator's `build` handler graduates from plan-only to direct execution.

### Live-bidirectional diagram↔code sync
Today: snapshot on import, snapshot on save. Live sync: when the user edits code, the diagram refreshes within seconds. Unblocks "open the project, both panes update each other" UX.

## Low-priority / parking lot

- Persistent-session fix (parked since P1)
- Initiative / Governance agents
- Live collaboration UX (cursors, presence, avatars) — needs CRDT first
- Build pipeline policy gates (depends on build sandbox redesign)
- Drift detection: extend to schema diff (today only blocks/edges/anchors are compared)
- Modify v2.x: rename across multiple files at once with cross-file ref tracking (current rename handles cross-file refs; v0.3 might surface them in the plan output for user review)
- Vendored polyglot fixture extension: add Java + Rust files (currently Py + Go only)

## Carried open threads from P2

1. **PR push policy** for ~30 P2 commits stacked on `phase2/w2`
2. **3 P1.W3 PRs still open**: #8 (D3), #9 (D4), #10 (D7) — wave 2 PRs (D5+D6, D8+D9) not opened yet either
3. **W2 W3-PRs split**: figure out a slicing for the W2 work too — drift could go in one big PR or split per day
