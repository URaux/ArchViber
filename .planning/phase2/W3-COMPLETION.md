# Phase 2 / W3 — Completion report

**Status**: COMPLETE 2026-04-26
**Branch**: `phase2/w2` (W3 work continued on the W2 branch since branches share the same upstream and W3 builds on W2's adapter work)
**Commits this week**: 6 atomic commits (D1+D2 merged, D3, D4, D5, D6, D7+D8+D10 merged into completion)

## What shipped

Drift detection + Modify v0.2 extract verb. Phase 2 closed.

| Day | Commit | Scope |
|---|---|---|
| D1+D2 | `<phase2/w3/d1-d2>` | Drift detector (pure logic) + markdown renderer |
| D3 | `<phase2/w3/d3>` | POST /api/drift route |
| D4 | `<phase2/w3/d4>` | drift-on-PR GH Actions workflow + standalone CI script |
| D5 | `<phase2/w3/d5>` | .archviber/policy.yaml schema + enforcement wiring |
| D6 | `<phase2/w3/d6>` | Modify v0.2 extract verb (closure detection, return-stmt rejection, read-only var → param) |
| D7+D8+D10 | this commit | Eval fixtures for extract + W3 completion + Phase 3 backlog |

(D9 smoke folded into the existing extract integration test in `extract.test.ts` which applies the plan and reads the file back.)

## Drift system (D1-D5)

- `src/lib/drift/{detect,render}.ts` — pure-logic diff between two IRs + chat-friendly markdown
- `src/app/api/drift/route.ts` — POST endpoint accepting `{headIr}`, loads base from `.archviber/ir.yaml`, returns `{summary, report, markdown}`
- `scripts/drift-check.mjs` — standalone CI script with `--enforce-policy` + `--policy <path>` flags
- `.github/workflows/drift.yml` — runs on PR, posts/updates a marker-tagged comment, fails workflow when policy violations detected
- `.archviber/policy.example.yaml` — checked-in template; users copy to `policy.yaml` to opt-in
- `src/lib/policy/{schema,check,load}.ts` — Zod-validated policy with permissive defaults

## Modify v0.2 (D6)

- `src/lib/modify/extract.ts` — extract method via ts-morph
  - Closure detection: same-file outer-scope reads → become parameters
  - Returns `not-found` conflict if range writes to outer-scope, contains `return`, or sits outside any function
  - Globals (lib.dom.d.ts, node_modules) correctly skipped
- Modify handler now classifies the user request as `rename` or `extract` and dispatches to the right plan layer; sandbox + git PR steps are shared (no special casing per verb)

## Tests

- W1 scope (orchestrator + chat + modify rename + smoke): 95/95
- W2 (adapters + ingest pipeline + names): 89 + 9 + 4 + 23 = 125
- W3 (drift + policy + extract): 16 + 13 + 4 + 6 = **39**
- Eval: 6/6 with `vitest.eval.config.ts`
- typecheck clean

Total Phase 2 test count: ~265 tests, all green.

## What's NOT in Phase 2 (Phase 3 backlog)

These are tracked separately because they were intentionally cut from P2 scope:

- **Modify v0.3 verbs**: move, split, merge — extract was the cheapest of the four, so it's the v0.2 scope; the rest follow the same plan/sandbox/PR scaffold but each needs its own AST manipulation pass
- **Team CRDT (Yjs/Automerge collaborative editing)** — was W2 alternative; user picked polyglot ingest instead
- **Persistent-session fix** — still parked from P1
- **Initiative / Governance agents** — never scoped
- **Bidirectional diagram↔code live sync** — only on-import + on-save snapshots today
- **Build sandbox redesign**: selective retry, sub-process isolation
- **Architecture-PR review bot** (separate from drift detection — drift just compares IRs, doesn't review)
- **Live collaboration UX** (cursors, presence, avatars) — required by CRDT, also deferred
- **Multi-language ingest beyond TS/Py/Go/Java/Rust**: C / C++ / C# / Ruby / PHP / Swift / Kotlin / Scala / Lua — recipe doc is the unblocker; each is ~1 day mechanical work
- **Live-LLM eval cron** — current eval is MockRunner-only; PLAN.md §0 row 2 calls for a weekly real-LLM holdout
- **Persistent telemetry** to `.archviber/cache/orchestrator-log.jsonl` — ring buffer is in-memory only
- **codex-rescue subagent wrapper bug** — stalled 5× across this session; companion script works direct
- **W3 modify integration test on golden repo** — covered locally via test-fixtures helper, but a vendored fixture project with a real e2e PR generation would be more rigorous
- **PR slicing** — Phase 2 has 30+ atomic commits unpushed; needs a strategy decision (chunk vs per-day vs single big PR)

## Architectural notes worth preserving

1. **Pure functions for diff + render** kept the drift surface trivial to wire into both the API route AND the CI script. No async, no I/O — the data flow `(Ir, Ir) → DriftReport → string` survives any caller change.
2. **Policy file uses Zod with `.strict()`** — silently ignoring unknown fields would let users typo `failOnRemvoed: true` and never get the protection. Schema validation throws on unknown fields, so misconfiguration is loud.
3. **Workflow comment-then-fail pattern** — the drift workflow posts the comment FIRST, then has a separate "Enforce policy" step that fails on captured exit code. Without this, `set -e` on the script step would short-circuit before the comment posts, leaving reviewers blind.
4. **Extract = same scaffold as rename** — both produce a `RenamePlan` and feed through `applyRenamePlan` + `runSandbox` + `createRenamePr`. Adding move/split/merge in P3 means writing one more `plan*` function, no scaffold changes.
5. **Closure detection scope-limited** to same-file outer-scope. This avoids ts-morph reaching into node_modules to "discover" that `console` is captured — globals/ambient are filtered out before they reach the captured set.

## Open follow-ups (carry into Phase 3)

1. PR strategy for ~30 P2 commits stacked on `phase2/w2`
2. 3 W3-of-Phase-1 PRs still open (#8, #9, #10)
3. codex-rescue investigation
4. Live-LLM eval cron stand-up
5. Persistent telemetry write-through to jsonl
6. Vendored polyglot fixture extension (add Java + Rust files for full e2e)
