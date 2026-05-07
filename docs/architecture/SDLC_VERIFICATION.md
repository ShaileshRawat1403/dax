# SDLC Verification

## Status

Phase 1 implemented as an explicit operator command:

```bash
dax sdlc verify
```

## Purpose

SDLC verification gives DAX a structured way to run repository readiness checks and emit evidence receipts. It is not a replacement for session verification, replay verification, or release checks.

Use the surfaces this way:

| Surface | Use |
| --- | --- |
| `dax verify <session-id>` | Verify a DAX session |
| `dax verify replay --events <file>` | Verify a DAX event log through Rust replay |
| `dax release check <session-id>` | Judge whether a session is ready for handoff or release |
| `dax sdlc verify` | Run repository SDLC checks and produce readiness evidence |

## Design Alignment

The old design branch proposed a generic SDLC harness. The implemented version keeps that shape but tightens two details for the current DAX codebase:

- JavaScript checks are script-aware. DAX only runs `bun run typecheck`, `bun run test`, or `bun run build` when those scripts actually exist.
- Optional external tools, such as security scanners, are skipped when missing instead of making the repo look guarded by default.

This keeps the command useful for real repositories without turning missing optional tooling into noisy failure.

## Posture

The report posture is derived from check results:

| Posture | Meaning |
| --- | --- |
| `verified` | Required checks passed; optional checks passed or were skipped |
| `guarded` | Required checks passed, but optional checks failed or errored |
| `blocked` | A required check failed or timed out |
| `failed` | A required check could not run |

If no checks are detected, the report is `guarded`, not `verified`.

## JSON Contract

`dax sdlc verify --format json` emits:

```json
{
  "schemaVersion": "dax.sdlc.verification.v1",
  "source": "dax",
  "runId": "...",
  "repoRoot": "/path/to/repo",
  "checks": [],
  "posture": "verified",
  "blockingReasons": [],
  "generatedAt": "..."
}
```

Use `--receipts` to include command-result evidence receipts with SHA-256 digests.
