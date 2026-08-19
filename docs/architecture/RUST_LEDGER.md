---
title: Rust Ledger
archetype: architecture
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - rust
  - ledger
last_reviewed: 2026-08-19
---

# Rust Ledger

## Status

Phase 1 implemented.

`dax-ledger` is a deterministic Rust proof surface for append-only, tamper-evident event chains. It is not wired into the live DAX event store yet.

## Purpose

`dax-core` proves that a complete event sequence replays to a deterministic final state. `dax-ledger` adds per-entry chain integrity: each ledger entry stores the previous entry hash, the canonical body hash, and the resulting chain hash.

This means DAX can detect:

- body mutation
- sequence gaps
- entry reordering
- forged chain hashes

## Phase 1 Boundary

Phase 1 is deliberately proof-only:

- Rust library crate: `crates/dax-ledger`
- Rust sidecar crate: `crates/dax-ledger-bin`
- TypeScript adapter: `packages/dax/src/rust/ledger.ts`
- Release packaging: `dax-ledger` ships beside the existing Rust sidecars

No runtime behavior changes in Phase 1. DAX does not yet write live session events into ledger files.

## JSON Boundary

Commands:

| Command | Purpose |
| --- | --- |
| `dax-ledger append` | Create the next in-memory ledger entry from `prev`, `body`, and `ts` |
| `dax-ledger verify` | Verify a supplied entry array |
| `dax-ledger append-file` | Append one entry to a JSONL ledger file |
| `dax-ledger export` | Read and verify a JSONL ledger file |
| `dax-ledger version` | Print sidecar version |

Entry schema:

```json
{
  "schema_version": "dax.ledger.entry.v1",
  "seq": 0,
  "ts": "2026-05-07T00:00:00Z",
  "prev_hash": "",
  "body_hash": "sha256:...",
  "chain_hash": "sha256:...",
  "body": { "kind": "run.created" }
}
```

## Alignment Correction

The draft branch proposed immediate JSONL file I/O and later event-store integration. That still fits, but the implementation uses an explicit file path for `append-file` and `export` instead of deriving `${DAX_HOME}/ledger/<run-id>.jsonl` inside Rust.

Reason: DAX’s TypeScript layer already owns environment, project, and path resolution. Keeping Rust path-explicit preserves the boundary rule:

> TypeScript orchestrates. Rust decides deterministic facts.

## Next Phases

Phase 2 should wire live event emission behind `DAX_LEDGER=1`, probably near the canonical run-event store rather than inside UI/presentation code.

Phase 3 should let `dax-audit` consume ledger verification as a trust signal. A broken ledger should degrade or fail trace continuity rather than silently falling back to unverified events.
