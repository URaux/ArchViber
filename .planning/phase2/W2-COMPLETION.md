# Phase 2 / W2 — Completion report

**Status**: COMPLETE 2026-04-26
**Branch**: `phase2/w2`
**Commits**: 9 atomic D-task commits (D1+D2 merged, D3, D4, D5, D6, D7, D8, D9, D10)

## What shipped

Language-agnostic ingest with **4 reference adapters** + a recipe doc that lets any future language plug in roughly 1 day of mechanical work. The W2 deliverable is the slot system — adapter count is incidental.

| Commit | Day | Scope |
|---|---|---|
| `46b11c0` | D1+D2 | LanguageAdapter interface + Python adapter |
| (Go commit) | D3 | Go adapter |
| `39de0b9` | D4 | Cross-language cluster naming (Languages: line in LLM prompt) |
| (D5 commit) | D5 | Vendored polyglot fixture (FastAPI + Go worker, 7 source files) |
| (D6 commit) | D6 | Per-language anchor coverage validator |
| (D7 commit) | D7 | Combined polyglot ingest pipeline (e2e on fixture) |
| (D8 commit) | D8 | Java adapter |
| (D9 commit) | D9 | Rust adapter — completes the 4 reference set |
| (this commit) | D10 | Recipe doc + W2 completion handoff |

(Run `git log --oneline phase2/w2 ^phase2/w1` for the full hash list.)

## The 5 adapters now live

| Language | File extension(s) | Frameworks detected |
|---|---|---|
| TypeScript / JS / TSX / JSX | .ts .tsx .js .jsx .mjs .cjs | (existing — preserved by adapter wrapper) |
| Python | .py .pyi | FastAPI, Django, Flask, Starlette, Tornado, aiohttp |
| Go | .go | Gin, Echo, Fiber, Chi, Beego, GORM, gRPC, net-http |
| Java | .java | Spring Boot, Spring, Quarkus, Micronaut, Servlet (jakarta + javax), Hibernate, Netty, Vert.x |
| Rust | .rs | Actix Web, Axum, Rocket, Warp, Tide, Tonic, Diesel, SQLx |

## Tests

- 5 adapter test files (registry + python + go + java + rust + typescript): **89 unit tests green**
- `tests/lib/ingest/anchor-coverage.test.ts`: 9 tests
- `tests/lib/ingest/pipeline.test.ts`: 4 e2e tests on polyglot fixture
- `tests/lib/ingest/name.test.ts`: 17 → 23 (W2.D4 added 6 cross-language tests)
- W1 scope intact: 95/95
- typecheck clean

## How to add another language

See `docs/HOW-TO-ADD-A-LANGUAGE.md`. Roughly:

1. Confirm `tree-sitter-wasms` ships your language's WASM grammar
2. Copy the closest existing adapter (python.ts for dynamic, java.ts for JVM-modifier, rust.ts for pub-keyword, go.ts for convention-based)
3. Adjust the AST walk for your language's node types
4. Register in `register-defaults.ts`
5. Add `FactLanguage` literal + `EXT_TO_LANGUAGE` entry
6. Write tests mirroring `python.test.ts` shape

P3 backlog languages (recipe-callable): C, C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Lua, Zig, Nim, Elixir, Haskell.

## Architectural choices worth preserving

1. **No auto-registration in adapter files**: each adapter file just exports the adapter object; only `register-defaults.ts` does `registerAdapter` calls. Lets tests import a single adapter without triggering others' WASM loads.
2. **WASM parser cached per adapter**: `loadParser()` returns a singleton; `pipeline.ts` further caches by adapter id so a 1000-file polyglot project still only loads each grammar once.
3. **Cross-language clustering left language-agnostic at the cluster/anchor layer**; multi-language awareness only lives in the LLM naming prompt (`name.ts` Languages: line).
4. **Path normalization to POSIX in `FactInputModule.file`**: every adapter does `.replace(/\\/g, '/')` before storing the file path, so Windows + Linux runs produce identical fact graphs.
5. **Visibility detection per language**: handled in adapter, NOT centralized. Each language's notion of "exported" is different (capital-letter in Go, `pub` in Rust, `public` modifier in Java, `__name` underscore-prefix convention in Python).

## Known limitations and follow-ups

- **Tree-sitter-rust `use_list` shape**: the Rust adapter handles `use foo::bar::Baz`, `use foo::bar::*`, and falls back to a best-effort string for `use foo::{a, b as bb}`. A more precise extraction would expand each name in the use_list as a separate import — defer to P3 or a focused fix in the same area.
- **Java method visibility**: I export only methods with explicit `public` modifier. Java has package-private (no modifier) and protected; for ArchViber's purposes "package-private API" is correctly NOT exported.
- **Go's stdlib `net/http`** is tagged `Go/net-http` instead of "Go". Pure-stdlib services running an HTTP server are usually still meaningfully different from a CLI tool, so this is a feature, not a bug — but if downstream consumers want plain "Go" for stdlib-only projects, that's an easy adjustment.
- **No Java/Rust e2e fixture**: the polyglot fixture (D5) is Python + Go only. Java + Rust adapters are unit-tested with inline strings. Adding a full e2e for all 4 reference languages is a P3 item.
- **`name.ts` `Languages:` prompt line** is emitted but has not been A/B tested against real LLM output. Live-LLM cron (PLAN.md row 2 decision) will surface whether the prompt change actually improves names.

## What's left for Phase 2 to be fully done

W3 is not yet started. Per `.planning/phase2/PLAN.md` §5:
- W3.D1-D5: drift detection (IR vs current AST diff, PR comment workflow, opt-in policy.yaml)
- W3.D6-D10: Modify v0.2 (extract verb)

Starting W3 requires no W2 prerequisites beyond what's shipped.

## Open threads (carried from W1)

- 3 W3 PRs (#8 D3, #9 D4, #10 D7) still open from earlier session — no action this session
- Phase2/w1 commits: 11 commits stacked, not yet pushed; PR strategy still TBD
- Phase2/w2 commits: 9 more on top of phase2/w1
- codex-rescue subagent wrapper bug still uninvestigated
