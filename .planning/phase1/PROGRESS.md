# Phase 1 Progress

## W1.D1 — IR Schema & Migrator (2026-04-14, night session)

### Decisions made (autonomously, per user delegation)

- **ID scheme**: persistent UID (pass-through from existing `node.id` — codebase uses `crypto.randomUUID()`). Not content-hash. Rationale: rename stability > IR-level canonical ID across machines; team git-diff is 1-line on rename; avoids edge-ref cascade.
- **Orphan semantics**: `container_id: string | null` where `null` = orphan. Reverse migrator reconstructs synthetic `ungrouped` bucket only when non-empty, matching `canvasToYaml` behavior in `schema-engine.ts`.
- **Zod added**: runtime validation is the "harness" promised to user. Alternative hand-rolled validator rejected.
- **IR as strict superset of SchemaDocument**: IR adds `version / metadata / code_anchors / audit_log / seed_state / policies`; pass-through for everything else. Zero UI risk — `yamlToCanvas` still consumes `SchemaDocument`.

### Code delivered

| File | Purpose |
|---|---|
| `src/lib/ir/schema.ts` | Zod schemas + exported TS types |
| `src/lib/ir/migrate.ts` | `schemaDocumentToIr`, `irToSchemaDocument` |
| `src/lib/ir/persist.ts` | `readIrFile`, `writeIrFile`, `parseIr`, `serializeIr` |
| `src/lib/ir/index.ts` | barrel export |
| `tests/lib/ir-migrate.test.ts` | 15 round-trip + validation tests |
| `tests/lib/ir-persist.test.ts` | 8 persistence + validation tests |

### Tests

`npx vitest run tests/lib/ir-migrate.test.ts tests/lib/ir-persist.test.ts` — **23/23 pass**.

Notable coverage
- Orphan reconstruction round-trip (Codex blocker #1)
- ID preservation through round-trip (no `prefixedId` mutation)
- Deterministic YAML serialization
- Strict Zod rejection of unknown fields and wrong version

### Commits

```
1f940c2 feat(ir): add canonical IR schema v0.1 with bidirectional SchemaDocument migrator
d296b44 chore(deps): add zod for IR schema validation
```

### TODOs flagged for future work (not blocking)

- Integrity validation: duplicate block IDs, edge endpoints referencing missing nodes. Not in Zod schema; could be added as a separate `validateIrReferentialIntegrity()` pass.
- Multiple `ungrouped` buckets on input: forward migrator treats them additively; probably fine, worth a note.
- Metadata timestamps: currently set on forward migrate; for existing repos this will bump `updatedAt` on every migration. `writeIrFile` should probably update `updatedAt` only on actual mutation, not just re-serialize.

### What's NOT done tonight (deferred to W1.D2+)

- Zustand store ↔ IR sync
- `context-engine.ts` accepting optional IR param
- Any chat/route.ts integration
- Any canvas or UI path change

Stopping here to avoid half-done work; checkpoint ready for review.
