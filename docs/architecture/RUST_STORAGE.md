# Rust Storage — `dax-storage`

**Status:** candidate architecture. No code yet.

This document is a reviewed roadmap note, not approval to add a new crate immediately. See [`RUST_PROOF_LADDER.md`](./RUST_PROOF_LADDER.md) for the broader Rust strategy and [`RUST_LEDGER.md`](./RUST_LEDGER.md) for the related event log work.

## Purpose

`dax-storage` is a candidate Rust + SQLite-backed durable store for DAX state that needs transactional guarantees: runs, events, approvals, policy decisions, and artifact metadata. It would replace selected per-domain JSON file stores with a single transactional database, give ACID guarantees by construction, and provide stable schema-versioned snapshots that `dax-audit` and `dax-ledger` can consume.

The current state landscape is JSON files with read–modify–write loops. The session that hardened the approval store against TOCTOU showed exactly why: every JSON store needs hand-written concurrency discipline, and every author of a new store risks getting it wrong. SQLite handles this correctly by default.

## Architecture boundary

The current Rust rule in DAX is: TypeScript orchestrates, Rust decides deterministic facts. Storage is different: it is persistence, not a proof surface. That means `dax-storage` must be treated as an explicit architecture exception before implementation.

The exception is acceptable only if these boundaries hold:

- DAX remains the source of run truth, approval truth, audit truth, and recovery truth.
- TypeScript continues to own product orchestration, environment resolution, project identity, CLI/TUI behavior, and migration entrypoints.
- Rust owns durable transactional persistence and deterministic schema migration results.
- `dax-storage` never silently redefines approval semantics, policy semantics, recovery semantics, or run lifecycle semantics.
- The sidecar exposes typed domain commands, not arbitrary raw table mutation for product code.

If implementation starts, update `crates/README.md` in the same PR to record this persistence exception.

## Why this matters

| Property | JSON files (today) | SQLite (with `dax-storage`) |
| --- | --- | --- |
| Concurrent writes | TOCTOU-prone, hand-rolled locking | ACID transactions, WAL mode |
| Partial writes / torn files | possible on crash mid-write | atomic by definition |
| Querying "all approvals where status=pending" | load whole file, filter in TS | one indexed `SELECT` |
| Cross-domain queries (run + its approvals + its events) | three file reads, manual join | one query |
| Schema evolution | ad-hoc per file | versioned migrations, canonical storage schema |
| Backup / export | tar the whole `~/.dax/` tree | `sqlite3 .dump > backup.sql` |
| `dax-audit` evidence reads | reads JSON files that may not be coherent | reads transactional snapshots |

The TOCTOU hardening already in the codebase reduces the immediate risk. SQLite is the structural fix if DAX needs stronger multi-process durability and cross-domain queries.

## Candidate crate layout

```
crates/
├── dax-storage/             # library
│   ├── src/
│   │   ├── lib.rs
│   │   ├── connection.rs    # connection pool, WAL setup, pragmas
│   │   ├── migrations.rs    # versioned schema migrations
│   │   ├── runs.rs          # runs table CRUD
│   │   ├── events.rs        # events table CRUD (foreign-keyed to runs)
│   │   ├── approvals.rs     # approvals table CRUD
│   │   ├── decisions.rs     # policy decisions table
│   │   ├── artifacts.rs     # artifact metadata table
│   │   ├── query.rs         # high-level cross-domain queries
│   │   └── error.rs
│   ├── migrations/
│   │   ├── 0001_initial.sql
│   │   └── 0002_*.sql       # additive only after v1
│   └── tests/
│       └── storage_golden.rs
└── dax-storage-bin/         # sidecar binary
    └── src/main.rs          # typed commands: migrate | approval-* | event-* | run-* | export | dump
```

## Schema (initial migration)

```sql
-- 0001_initial.sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  status      TEXT NOT NULL,           -- mirrors RunStatus
  trust       TEXT,                    -- JSON blob, optional
  error       TEXT,                    -- JSON blob, optional
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  completed_at TEXT
);

CREATE TABLE events (
  event_id    TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  seq         INTEGER NOT NULL,
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,           -- JSON
  ledger_chain_hash TEXT,              -- nullable; populated when dax-ledger is enabled
  UNIQUE (run_id, seq)
);
CREATE INDEX idx_events_run ON events(run_id, seq);

CREATE TABLE approvals (
  request_id       TEXT PRIMARY KEY,   -- mirrors Permission.Request.id
  session_id       TEXT NOT NULL,      -- current approval anchor
  run_id           TEXT REFERENCES runs(run_id),
  status           TEXT NOT NULL,      -- pending | once | always | rejected | expired
  permission       TEXT NOT NULL,
  patterns         TEXT NOT NULL,      -- JSON array
  always_patterns  TEXT NOT NULL,      -- JSON array
  metadata         TEXT,               -- JSON
  tool             TEXT,               -- JSON, optional message/call id
  resolution       TEXT,               -- JSON, populated on resolve
  resolved_at      TEXT,
  actor            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_approvals_session_status ON approvals(session_id, status);
CREATE INDEX idx_approvals_run_status ON approvals(run_id, status);
CREATE INDEX idx_approvals_pending ON approvals(status) WHERE status = 'pending';

CREATE TABLE decisions (
  decision_id  TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(run_id),
  step_id      TEXT,
  decision     TEXT NOT NULL,          -- allow | ask | deny
  risk         TEXT NOT NULL,          -- low | medium | high | critical
  reason       TEXT NOT NULL,
  gate         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_decisions_run ON decisions(run_id);

CREATE TABLE artifacts (
  artifact_id  TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(run_id),
  kind         TEXT NOT NULL,
  path         TEXT NOT NULL,
  content_hash TEXT,
  size_bytes   INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_artifacts_run ON artifacts(run_id);

INSERT INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
```

## On-disk location

`${DAX_HOME}/state.db` (default), plus `state.db-wal` and `state.db-shm` from WAL mode. Single-file backup: copy `state.db` after a `PRAGMA wal_checkpoint(TRUNCATE)`.

## Public Rust API

```rust
pub struct Storage { /* connection pool */ }

impl Storage {
    pub fn open(path: &Path) -> Result<Self, StorageError>;
    pub fn migrate(&self) -> Result<(), StorageError>;

    pub fn runs(&self) -> RunsRepo;
    pub fn events(&self) -> EventsRepo;
    pub fn approvals(&self) -> ApprovalsRepo;
    pub fn decisions(&self) -> DecisionsRepo;
    pub fn artifacts(&self) -> ArtifactsRepo;

    pub fn transaction<T, F>(&self, f: F) -> Result<T, StorageError>
    where F: FnOnce(&Tx) -> Result<T, StorageError>;
}

pub struct ApprovalsRepo<'a> { /* ... */ }

impl<'a> ApprovalsRepo<'a> {
    pub fn create(&self, approval: &Approval) -> Result<Approval, StorageError>;
    pub fn get(&self, id: &str) -> Result<Option<Approval>, StorageError>;
    pub fn list_pending(&self, run_id: &str) -> Result<Vec<Approval>, StorageError>;
    pub fn resolve(&self, id: &str, resolution: &Resolution) -> Result<Approval, StorageError>;
}
```

The TOCTOU pattern from the session hardening becomes a single transactional `resolve` call. Concurrent resolves serialize correctly because SQLite serializes transactions.

## Sidecar JSON contract

| Command | Stdin | Stdout |
| --- | --- | --- |
| `dax-storage migrate` | `{}` | `{ "applied": [1, 2, ...], "current_version": N }` |
| `dax-storage approval-create` | `{ "request": PermissionRequest }` | the persisted approval row |
| `dax-storage approval-get` | `{ "request_id": "..." }` | the row, or `null` |
| `dax-storage approvals-pending` | `{ "session_id": "...", "run_id": "..." }` | `{ "rows": [...] }` |
| `dax-storage approval-resolve` | `{ "request_id": "...", "reply": "once" \| "always" \| "reject", "message": "..." }` | the resolved row |
| `dax-storage event-append` | `{ "run_id": "...", "expected_seq": 3, "event": {...}, "ledger_chain_hash": "..." }` | the persisted event row |
| `dax-storage events-list` | `{ "run_id": "..." }` | `{ "rows": [...] }` |
| `dax-storage export` | `{ "format": "sql" \| "json" }` | dump to stdout |
| `dax-storage dump` | `{}` | schema + row counts per table |

The sidecar is a thin wrapper, but product code must use typed commands through the TypeScript adapter. Raw SQL or table-name driven mutation belongs in tests and admin diagnostics only.

## TypeScript bridge

`packages/dax/src/rust/storage.ts`

```typescript
export const storage = {
  runs: {
    create(run: Run): Promise<Run>,
    get(id: string): Promise<Run | null>,
    update(id: string, patch: Partial<Run>): Promise<Run>,
    list(filter?: RunFilter): Promise<Run[]>,
  },
  approvals: {
    create(request: PermissionRequest): Promise<StoredApproval>,
    get(requestId: string): Promise<StoredApproval | null>,
    listPending(filter: { sessionId?: string; runId?: string }): Promise<StoredApproval[]>,
    resolve(requestId: string, reply: PermissionReply): Promise<StoredApproval>,
  },
  events: { /* ... */ },
  decisions: { /* ... */ },
  artifacts: { /* ... */ },
}
```

Behind a feature flag during migration:

```typescript
const STORAGE_BACKEND = process.env.DAX_STORAGE_BACKEND ?? "json"
// "json" → existing TS file stores
// "sqlite" → dax-storage sidecar
```

This lets us cut over per-domain (approvals first, then events, then runs) without forcing a big-bang migration. If `DAX_STORAGE_BACKEND=sqlite` is set and the sidecar is unavailable, DAX should fail loudly instead of silently falling back to JSON.

## Test strategy

| Layer | Coverage |
| --- | --- |
| Rust unit (`cargo test -p dax-storage`) | Per-repo CRUD; transaction commit/rollback; migration apply/idempotence; concurrent transactions serialize correctly |
| Rust integration (`tests/storage_golden.rs`) | End-to-end: migrate → seed → query → assert; in-memory `:memory:` SQLite for speed |
| Rust stress | N concurrent appender threads, expect zero loss; concurrent resolve/list returns consistent snapshots |
| TS parity (`packages/dax/src/rust/storage.parity.test.ts`) | The two backends (`json` vs. `sqlite`) produce identical results for the same operation sequence on a shared fixture |
| Eval scenario (`evals/scenarios/storage_concurrent_writes_no_loss.json`) | Smoke suite: 100 concurrent appends, expect 100 rows visible |
| Eval scenario (`evals/scenarios/storage_resolve_idempotent.json`) | Smoke suite: same approval resolved twice, second call returns first resolution unchanged (no double-write) |

## Phased delivery

| Phase | Scope | Shippable signal |
| --- | --- | --- |
| 1 | `dax-storage` lib + `dax-storage-bin` with migrations and approvals table only. TS bridge mirrors current `Permission.Request` and `Permission.reply` behavior. Feature flag `DAX_STORAGE_BACKEND=sqlite`. Two eval scenarios in CI. Both backends run in parity tests. | TOCTOU vanishes for approvals; `dax-storage migrate` idempotent across restarts. |
| 2 | Add `events`, `runs`, `decisions` tables. Migrate session state and event store. Wire `dax-audit` to read from SQLite when flag is on. Optional `ledger_chain_hash` column links to `dax-ledger`. | A real session run produces events visible in both stores; `dax-audit` works against SQLite transactional snapshots. |
| 3 | Add `artifacts` and remaining state. Default `DAX_STORAGE_BACKEND=sqlite`. Deprecate JSON file stores. Provide a one-shot `dax-storage import` from existing JSON state. | Fresh installs use SQLite by default; existing users have a clean upgrade path. |

Phase 1 alone is the smallest cut that proves the design and removes the TOCTOU class of bugs from approvals.

## Non-goals

- **No multi-process write coordination beyond SQLite WAL.** SQLite handles single-machine concurrent processes correctly via filesystem locking + WAL. We do not add a separate lock daemon.
- **No remote replication or distributed consensus.** This is local-first. Replication and sync belong to a future product layer (think: cloud-backed teams), not the storage crate.
- **No encryption at rest in v1.** Defer to OS-level disk encryption. Schema field-level encryption can be added later without breaking changes.
- **No ORM-style query builder.** The repos expose typed methods for known queries. Ad-hoc dynamic queries go through raw SQL paths in tests and admin diagnostics, not product APIs.
- **No forever-dual-format runtime.** JSON remains the default until SQLite parity is proven. The migration path is the `dax-storage import` command in Phase 3, not permanent dual writes.
- **No NoSQL-style flexibility.** Schema is enforced. New shapes get a new migration.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Migration apply on boot blocks startup | Migrations run lazily on first repo access, not at process start. Schema version cached in-memory after first check. |
| SQLite file corruption (rare but possible) | WAL mode + `PRAGMA synchronous=NORMAL`; daily `wal_checkpoint(TRUNCATE)` hook; a `dax-storage repair` command in Phase 2. |
| Developers without the Rust binary in dev | Use JSON backend when `DAX_STORAGE_BACKEND` is unset. Fail loudly when the env says `sqlite` and the binary is absent. |
| Schema drift between Rust and TS-side type definitions | Rust owns the canonical storage schema; a generated `storage.types.ts` is checked in and validated by parity tests. |
| Big-bang migration risk | Per-domain feature flag rollout; both backends running in parity tests during Phase 1–2. |
| Transactions held too long block other writers | All public APIs target sub-millisecond transactions; long-running scans use snapshot isolation, not held transactions. |
| Schema migrations forward-only | Document explicitly that migrations are additive after v1; destructive changes require a new major schema version. |

## Relationship to other crates

| Crate | Relationship |
| --- | --- |
| `dax-core` | `dax-core` continues to operate on in-memory event sequences for replay. `dax-storage` provides the persistence layer when those events need to live across processes. |
| `dax-policy` | `dax-policy` decisions are persisted into the `decisions` table. `dax-audit` later reads them as evidence. |
| `dax-audit` | Phase 2 onward, `dax-audit` can read SQLite snapshots instead of TS-side JSON files when the backend flag is enabled. The `evidence_completeness` check becomes a SQL query: "every `events.kind = 'tool.invoked'` row has a matching `decisions` row." |
| `dax-ledger` | Each `events` row carries a `ledger_chain_hash` column when the ledger feature flag is on. `dax-storage` is the queryable projection; `dax-ledger` is the tamper-evident append-only record. Storage must not be treated as a substitute for ledger integrity. |
| `dax-indexer` | Independent. Phase 2+ may move the indexer cache from JSON files to SQLite if the cache becomes a hot path. |

## Out-of-scope follow-ups (track elsewhere)

- Snapshot/checkpoint export for time-travel debugging
- Cloud-backed sync (S3-compatible target for shared team state)
- Field-level encryption for sensitive metadata
- Read-replicas for Soothsayer dashboards
- Schema-aware diff tool ("what changed in approvals between these two backups")

## Decision log

- **SQLite over Postgres or sled** — SQLite is a single file, embeddable, zero-ops, and ubiquitous. Postgres requires a server. sled is interesting but less stable and harder to inspect with stock tools.
- **rusqlite over sqlx** — synchronous API matches the sidecar's batch-per-invocation model. sqlx adds an async runtime cost we don't need.
- **Single database file over per-domain databases** — cross-domain queries (run + its approvals + its events) are common and natural. One file, one schema, one backup unit.
- **Forward-only migrations** — easier to reason about; rollback is restore-from-backup, not auto-downgrade.
- **Sidecar binary over FFI / NAPI** — same rationale as the rest of the Rust roadmap. Consistency wins.
- **Feature flag during cutover** — proves correctness via parity tests on real workloads before the JSON backend goes away.
