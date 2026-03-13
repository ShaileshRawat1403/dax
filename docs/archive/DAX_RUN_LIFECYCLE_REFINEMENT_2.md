# DAX Run Lifecycle Refinement 2

This document is the second refinement bridge for [DAX_RUN_LIFECYCLE_MODEL.md](DAX_RUN_LIFECYCLE_MODEL.md).

It exists because the first lifecycle correction solved the weak lightweight `run` case, but under-classified strong artifact-heavy runs.

## Purpose

Refine lifecycle derivation so DAX can distinguish between:

- lightweight visible-answer runs that still need reconciliation
- artifact-heavy or tool-driven runs that finished cleanly and should be terminal

This is still a lifecycle-only slice. It is not a write-governance slice and not a UI slice.

## Evidence From Validation

The first lifecycle pass produced the correct behavior for:

- lightweight `run` with visible output but no clear closure
- planning-only sessions that actually terminate cleanly

But it also exposed a repeated gap:

```text
artifact-heavy session
retained artifacts present
no pending approvals
no active tool execution
still classified as active
```

This means the current lifecycle rule is too dependent on explicit visible terminal output.

## Problem Statement

The current derivation is conservative in the right direction, but not yet complete.

It protects against false completion on lightweight sessions, but fails to recognize a valid completion path where the runtime ends after a tool-driven execution chain rather than a final conversational answer.

## Refinement Question

What evidence is sufficient to promote:

```text
active -> completed
```

for strong artifact-heavy runs without regressing the lightweight `run` fix?

## Terminal Signals For This Refinement

This refinement should allow `completed` when all of the following are true:

1. execution actually started
2. no pending approvals remain
3. no tool activity is still pending
4. no interruption/cancellation signal is present
5. the session has strong completion evidence from a tool-driven path

For this slice, strong completion evidence can be one of:

- an explicit terminal assistant/result message
- or a completed tool-driven path with strong retained output evidence

Examples of strong retained output evidence:

- retained artifacts
- retained diff evidence
- repeated completed tool activity across assistant messages

## Guardrails

The refinement must not promote lightweight visible-answer runs just because they have:

- one assistant answer
- no pending approvals
- a normal stop finish

Those sessions should remain:

```text
active
requires_reconciliation = true
```

until a stronger closure rule exists.

## Acceptance Cases

### Case 1: Lightweight visible-answer run

Should remain:

- `lifecycle_state = active`
- `terminal = false`
- `requires_reconciliation = true`

### Case 2: Planning-only session

Should remain:

- `lifecycle_state = completed`
- `terminal = true`

### Case 3: Artifact-heavy completed run

Should become:

- `lifecycle_state = completed`
- `terminal = true`
- `requires_reconciliation = false`

even when there is no final visible conversational stop message, as long as the strong terminal signals above are present.

## Implementation Boundary

This slice should only change:

- lifecycle derivation logic
- lifecycle-focused tests
- lifecycle-dependent session/trust/readiness outputs if the derived state changes

This slice should not change:

- artifact indexing logic
- write-governance semantics
- timeline event schema
- TUI behavior

## Success Signal

This refinement is successful when:

1. the known lightweight `run` case still stays non-terminal
2. the known planning session still stays terminal
3. the known artifact-heavy session becomes terminal
4. `verify` and `release check` stop blocking that strong path on lifecycle alone
