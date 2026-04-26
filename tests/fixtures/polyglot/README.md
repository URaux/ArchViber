# Polyglot fixture — fastapi-with-go-worker

Minimal, vendored fixture used by W2.D6 anchor-coverage validator and W2.D7 combined-ingest tests. Two services in two languages share a contract:

- `api/` — Python 3.11 FastAPI HTTP layer
  - `main.py` — endpoint definitions
  - `models.py` — Pydantic request/response models
  - `db.py` — async SQLAlchemy session helpers
  - `queue.py` — enqueue helper (talks to the Go worker)

- `worker/` — Go 1.21+ worker
  - `main.go` — entry / poll loop
  - `queue.go` — queue interface + Redis-backed impl
  - `handler.go` — message handlers

This is a fixture, not a runnable project — no `pyproject.toml` / `go.mod` / dependencies are vendored. Tests parse the source files via tree-sitter via the language adapters and inspect the resulting Facts. Don't add real deps.

To use in a test:
```ts
import path from 'node:path'

const FIXTURE_ROOT = path.join(__dirname, '../../fixtures/polyglot')
// scan + ingest…
```
