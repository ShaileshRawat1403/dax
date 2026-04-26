# Rust Proof Ladder

## What This Is

The Rust proof ladder is three deterministic crates that make DAX's runtime contract testable.

DAX does not make model outputs deterministic.

DAX provides a deterministic runtime contract around stochastic model execution.

The proof ladder makes that contract verifiable by machine, not just by convention.

## The Boundary

```
Model output              ← stochastic, not controlled by DAX
────────────────────────────────────────────────────────────────
Runtime contract          ← deterministic, owned by DAX
  - what happened?           dax-core
  - should it proceed?       dax-policy
  - is the run trustworthy?  dax-audit
```

The model can produce different outputs on identical inputs. That is expected and accepted.

What must not vary is whether DAX correctly recorded what happened, correctly evaluated whether an action was permitted, and correctly assessed whether the resulting run is trustworthy.

## The Three Crates

### `crates/dax-core` — Replay

**Proves: what happened.**

Given a canonical DAX event log, `dax-core` replays it to reconstruct the final run state.

The same event log produces the same state every time. Invalid transitions are rejected. Sequence gaps are detected. Approval requirements are derived from the event record, not from memory.

This is the foundation. Without deterministic replay, "what happened" is archaeology. With it, it is proof.

### `crates/dax-policy` — Policy gate

**Proves: whether an action should proceed.**

`dax-policy` evaluates a proposed tool action against a policy context and returns a deterministic decision: `allow`, `ask`, or `deny`.

The decision is derived from structured inputs — tool classification, path zone, command risk, profile, budget, blocklist, allowlist — with no model call involved. The same request against the same policy produces the same decision every time.

This is what makes the approval gates auditable. The operator can inspect exactly why an action was blocked, permitted, or escalated.

### `crates/dax-audit` — Trust posture

**Proves: whether a run is trustworthy.**

`dax-audit` evaluates six structured checks against a completed (or in-progress) run and derives a trust posture: `verified`, `policy_clean`, or `review_needed`.

The checks are:

| Check | What it tests |
| ----- | ------------- |
| `approval_compliance` | All required approvals were resolved |
| `policy_compliance` | No blocking policy findings remain |
| `artifact_presence` | The run produced at least one artifact |
| `evidence_completeness` | Policy decisions were recorded as evidence |
| `trace_continuity` | The event trace contains completed steps |
| `overrides_justified` | Any governance overrides are flagged for review |

A replay failure surfaces immediately as a blocking `trace_continuity` failure, not silent degradation.

## Integration Pattern

Each crate has a companion `*-bin` that reads JSON from stdin and emits JSON to stdout. TypeScript calls the sidecar via `Bun.spawn`. The typed adapters are:

- `replayRunStateWithRust(events, options?)` → `DaxCoreRunState`
- `createRustProofReport(events, options?)` → `DaxCoreProofReport`
- `evaluatePolicyWithRust(request, options?)` → `DaxPolicyResult`
- `evaluateAuditWithRust(input, options?)` → `DaxTrustReport`

The boundary is a JSON contract. TypeScript orchestrates. Rust decides deterministic facts.

## What the Proof Ladder Does Not Claim

- It does not prove that model output is correct.
- It does not prove that the AI understood your intent.
- It does not guarantee that approved actions produced the right result.
- It is not a formal verification system.
- It does not sandbox execution.

The proof ladder provides deterministic checks on the runtime layer. Model semantics remain stochastic.

## Golden Fixture Tests

Each crate locks its output via golden fixture files. Running `cargo test --workspace` replays every fixture and asserts exact JSON equality. A code change that alters the shape of any proof report fails the golden test immediately.

This keeps the proof surfaces stable across refactors.

## Safe Claim

DAX uses Rust for deterministic replay, policy evaluation, and audit proof surfaces around stochastic model execution.

## Relationship to the Trust Model

The audit crate implements the trust signal evaluation described in `DAX_TRUST_MODEL.md`. The posture ladder (`verified` / `policy_clean` / `review_needed`) maps directly to the structured signals defined there.

The proof ladder does not replace the trust model. It makes the trust model machine-checkable.
