# DAX Run Lifecycle Implementation

This document is the implementation bridge for [DAX_RUN_LIFECYCLE_MODEL.md](DAX_RUN_LIFECYCLE_MODEL.md).

It translates the evidence-driven lifecycle model into concrete runtime and surface changes, while keeping the first implementation slice narrow.

## Purpose

Define:

- where lifecycle state should be computed
- when `run` may leave `active`
- what signals are required for `completed`
- how `interrupted` and `abandoned` should be detected
- which existing surfaces must reflect corrected lifecycle state

## Current State

Validation exposed a repeated mismatch:

```text
visible answer present
session outcome still active
no execution_completed signal
```

Current outcome derivation is still mostly surface-level.

The clearest existing simplification is in [session.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/cli/cmd/session.ts):

- `deriveSessionHistoryOutcome(...)`
- `execution_completed` in the derived timeline is treated as the main completion proof
- otherwise sessions generally remain `active`

This is useful as a presentation heuristic, but not strong enough as the canonical lifecycle contract.

## Canonical Computation Boundary

Lifecycle truth should be computed once, then reused.

Recommended ownership:

1. canonical lifecycle derivation helper in runtime/session-facing code
2. `run` should emit enough signals for that helper to work reliably
3. `session show`, `session inspect`, `verify`, and `release check` should consume the derived lifecycle state instead of inventing their own outcome logic

The first implementation does not need a deep runtime rewrite. It needs a shared lifecycle summary layer.

## Proposed Implementation Shape

### Step 1: Introduce shared lifecycle summary

Add a shared helper with a narrow contract such as:

```text
collectSessionLifecycle(sessionID) -> {
  lifecycle_state
  terminal
  completion_reason
  latest_execution_at
  requires_reconciliation
}
```

This helper should eventually use:

- session metadata
- message/timeline evidence
- approval state
- explicit interruption/cancellation signals when present

### Step 2: Replace surface-local outcome guessing

Current surfaces that should stop guessing independently:

- `session list`
- `session show`
- `session inspect`
- `verify`
- `release check`

They should reuse the lifecycle summary rather than recomputing “completed vs active” from ad hoc conditions.

## Required Signals for `completed`

`run` may only leave `active` for `completed` when the lifecycle helper can prove:

1. a run request actually started
2. the current execution loop finished
3. no approval gate remains unresolved for the current path
4. no pending continuation is implied by the runtime
5. a terminal completion reason can be recorded

For the first slice, “terminal completion reason” can remain simple, for example:

- `execution_completed`
- `execution_interrupted`
- `session_abandoned`

## Detecting `interrupted`

First implementation goal:

- use existing explicit interrupt/cancel signals only
- do not invent probabilistic heuristics yet

If DAX already knows the user or runtime explicitly interrupted the run, lifecycle should become:

```text
interrupted
```

This should be terminal and should propagate into history, verification, and readiness.

## Detecting `abandoned`

This should be conservative in the first slice.

Do not attempt automatic timeout-based abandonment immediately.

Instead, the first implementation should make room for it by:

- distinguishing non-terminal `active`
- marking sessions that need later reconciliation
- avoiding false `completed`

The first implementation can stop at:

```text
active + requires_reconciliation = true
```

rather than immediately classifying abandonment.

That keeps the model honest without overreaching.

## Surface Propagation

### `session list`

Should eventually display lifecycle-aware outcomes, but the first slice can keep the label set narrow as long as it becomes more truthful.

Immediate need:

- stop implying that visible output-less completion logic is sufficient

### `session show`

Should expose:

- lifecycle state
- whether the session is terminal
- whether the session still needs reconciliation

This is the first priority surface after the shared helper exists.

### `session inspect`

Should explain:

- why the session is still active
- what evidence supports completion or non-completion
- whether the session ended cleanly or still needs reconciliation

### `verify`

Should treat lifecycle incompleteness as a distinct input.

For example:

- active/reconciliation-needed sessions should not silently look like ordinary incomplete trust
- lifecycle incompleteness should be expressible in checks or degrading factors

### `release check`

Should treat non-terminal lifecycle state as a blocker or at least a stronger missing-readiness signal than ordinary incomplete evidence.

## Existing Code Touchpoints

The first narrow implementation likely needs to touch:

- [run.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/cli/cmd/run.ts)
  - ensure `run` can expose terminal completion more honestly
- [session.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/cli/cmd/session.ts)
  - replace `deriveSessionHistoryOutcome(...)` with shared lifecycle usage
- [verify-session.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/trust/verify-session.ts)
  - include lifecycle incompleteness as trust-context input
- [check-session-release.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/release/check-session-release.ts)
  - treat non-terminal lifecycle state as readiness-relevant

## Minimal First Slice

The first implementation slice should do only this:

1. add a shared lifecycle derivation helper
2. make `session show` and `session inspect` consume it
3. propagate lifecycle incompleteness into `verify`
4. propagate lifecycle incompleteness into `release check`

Do not implement yet:

- timeout-based abandonment
- workstation/TUI lifecycle visuals
- broad timeline event redesign
- provider-specific completion heuristics

## Acceptance Signals

The first lifecycle implementation slice is successful when:

1. a lightweight `run` with visible output no longer silently looks equivalent to a cleanly completed session
2. `session show` and `session inspect` can explain non-terminal state
3. `verify` and `release check` reflect lifecycle incompleteness explicitly
4. no surface needs to guess completion independently

## Non-Goals

This bridge does not yet define:

- exact runtime event schema changes
- abandonment timeout policy
- UI/TUI behavior changes
- write-governance fixes

Those belong to later slices after lifecycle truth is visible and reused consistently.
