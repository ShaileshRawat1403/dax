# DAX Evals

## Purpose

DAX evals verify deterministic execution-quality guarantees, not model quality.
They test that the runtime contract around stochastic model execution holds
across releases.

DAX evals start as deterministic execution checks:

- dax-core proves what happened (replay, proof receipts)
- dax-policy proves whether actions should proceed
- dax-audit proves whether a run is trustworthy

## Eval Ladder

| Level | What it covers | Implementation |
|-------|---------------|----------------|
| 0 | Rust proof tests | `cargo test -p dax-core -p dax-policy -p dax-audit` |
| 1 | Deterministic smoke evals | `bun run eval:smoke` — this layer |
| 2 | Fixture repo evals | Planned: real CLI subprocess scenarios |
| 3 | Model-assisted evals | Planned: token efficiency, provider comparisons |

Level 1 (this layer) reuses the existing TypeScript wrappers for
`dax-core`, `dax-policy`, and `dax-audit` directly. No subprocess
calls, no model calls, no dashboards.

## Current Scope

The smoke suite covers three scenarios:

| Scenario | Kind | What it tests |
|----------|------|---------------|
| `replay_valid_completed_run` | `core_proof` | Proof receipt: result, status, hashes |
| `policy_deny_destructive_command` | `policy` | Policy gate: deny + critical risk |
| `audit_verified_clean_run` | `audit` | Trust posture: verified + passed |

### Scenario contract

```json
{
  "name": "policy_deny_destructive_command",
  "suite": ["smoke", "proof"],
  "kind": "policy",
  "input": "../fixtures/policy/deny_rm_rf.json",
  "expected": {
    "decision": "deny",
    "risk": "critical"
  }
}
```

Supported `kind` values: `core_proof`, `policy`, `audit`.

The `suite` field may be either a single suite name or an array of suite
names when a scenario belongs to more than one suite.

Paths in `input` are relative to `evals/scenarios/`.

### Prefix matching

Expected values ending with `:` use prefix matching. This allows
checking `sha256:` without hardcoding the full hash:

```json
{ "stateHash": "sha256:", "eventSequenceHash": "sha256:" }
```

## Report Contract

Reports are written to `artifacts/evals/<suite>-report.json` (gitignored).

```json
{
  "schema_version": "dax.eval.report.v1",
  "suite": "smoke",
  "generated_at": "2026-04-29T00:00:00.000Z",
  "summary": { "total": 3, "passed": 3, "failed": 0 },
  "scenarios": [ ... ]
}
```

## Non-Goals

- LLM-as-judge evaluations
- Leaderboards or provider comparison dashboards
- Token efficiency metrics (Level 3)
- Model quality benchmarks

## Running Evals

```bash
bun run eval:smoke     # run smoke suite (default)
bun run eval:proof     # run proof suite
bun run eval           # alias for eval:smoke
```

The runner exits with code 1 if any scenario fails.
