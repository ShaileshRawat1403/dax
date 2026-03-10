# DAX Real Work Evaluation Runbook

## Purpose

Run real workflows through DAX end to end and capture friction across the full operator loop. The goal is to identify practical issues in discoverability, readability, navigation, trust explanation, and readiness clarity.

## Scope

Evaluate the system across the full operator lifecycle:

```text
plan -> run -> approvals -> artifacts -> audit -> verify -> release check -> session history
```

This runbook captures observations from real work rather than synthetic tests.

## Evaluation Principles

- Use real tasks whenever possible.
- Record friction immediately during use.
- Avoid solving issues during the run; only document them.
- Prefer short structured notes over long explanations.

## Test Workflow Template

### Task

Short description of the real task.

Example:

```text
Audit dependencies in repository
Generate summary report
Review readiness for release
```

### Commands Used

List the commands executed in order.

Example:

```text
dax plan
dax run
dax approvals
dax artifacts
dax audit
dax verify
dax release check
dax session show
dax session inspect
```

### Outcome

Session outcome and readiness state.

Example:

```text
Outcome: completed
Verification: verification_passed
Readiness: review_ready
Stage: verification
```

## Evaluation Dimensions

### Discoverability

Questions:

- Were the correct commands obvious?
- Did the help system guide the workflow correctly?
- Did the operator need to guess commands?

Record:

- missing command hints
- unclear command names
- help output gaps

### Readability

Questions:

- Were outputs understandable in one pass?
- Were summaries too verbose or too thin?
- Did operator language feel clear?

Record:

- confusing output sections
- redundant information
- internal wording leaking into operator output

### Navigation

Questions:

- Was it easy to move between session surfaces?
- Did `session list/show/inspect` work intuitively?
- Was it clear where deeper inspection belonged?

Record:

- navigation confusion
- missing links between surfaces
- redundant commands

### Trust Explanation

Questions:

- Did `audit` clearly explain trust posture?
- Did `verify` explain why verification passed or failed?
- Did signals feel complete?

Record:

- missing signals
- unclear trust reasoning
- confusing blocker explanations

### Readiness Clarity

Questions:

- Did `release check` clearly explain readiness?
- Were blockers easy to understand?
- Did the readiness ladder feel meaningful?

Record:

- ambiguous readiness states
- misleading readiness classifications
- missing evidence signals

## Session Review Checklist

For each evaluated session record:

```text
Session ID
Task
Outcome
Stage
Verification Result
Readiness Result
```

Then answer:

- What worked well?
- What slowed the workflow?
- What was confusing?
- What should change?

## Evidence Log

Maintain a running table:

| Session | Issue | Surface | Severity |
| ------- | ----- | ------- | -------- |
| ses_xxx | confusing audit wording | audit | medium |
| ses_xxx | missing artifact summary | session show | low |

## Success Criteria

The operator loop should allow a user to:

1. Execute a task end to end.
2. Understand session progression quickly.
3. Explain trust posture.
4. Determine readiness confidently.
5. Navigate session history without confusion.

## Non-Goals

This evaluation does not aim to:

- redesign the system
- introduce new abstractions
- expand UI/TUI surfaces

The goal is only to observe real friction.

## When to Stop

Run at least 5 to 10 real sessions before making changes. Patterns should emerge naturally.

## Evaluation Batch 001

This first batch records four representative sessions across lightweight and artifact-producing work. It is not enough to justify product changes yet, but it is enough to establish an evidence baseline.

### Commands Used

```text
dax session list
dax session show <session-id>
dax session inspect <session-id>
dax verify <session-id>
dax release check <session-id>
```

### Session Record: ses_328ed3310ffe50coOPafJELC5f

Task:

```text
Understanding DAX
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- `session show` exposed outcome, trust posture, and stage quickly.
- `session inspect` made it obvious that the session had no artifacts or approvals.
- `verify` and `release check` were consistent with each other.

What slowed the workflow:

- The path from `show` to `inspect` to `verify` still depends on command recall.

What was confusing:

- `stage: review` on a conversational session feels semantically stretched.
- `review_ready` sounds stronger than the actual evidence level for a no-artifact session.

What should change:

- Revisit stage derivation for lightweight conversational sessions after more evidence.
- Revisit readiness wording if artifact-light sessions continue to look too positive.

### Session Record: ses_32d662276ffervMwsjjDxy68o2

Task:

```text
MCP capabilities and best read-only options
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- `session inspect` showed a concise progression with only session creation, execution start, and completion.
- `verify` exposed the exact missing trust signals in a readable structure.

What slowed the workflow:

- Moving from summary to explanation still requires explicit command switching.

What was confusing:

- The session is functionally informational, but the output still reads like an execution record awaiting stronger evidence.
- Missing policy evaluation and findings resolution appear repeatedly even when the session shape does not naturally produce them.

What should change:

- Observe whether informational sessions need a lighter verification/readiness path.
- Watch for repetitive incompleteness wording across read-only sessions.

### Session Record: ses_32ddd10fbffe6xBlnTvYtoTxF3

Task:

```text
Multi-step repo work with retained artifacts and code changes
```

Outcome:

```text
Outcome: completed
Stage: implementation
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- `session show` and `session inspect` clearly surfaced artifact count, timeline count, and current stage.
- `session inspect` made the progression and artifact accumulation legible.
- `release check` showed stronger positive signals than the lighter sessions because artifacts and clear audit evidence were present.

What slowed the workflow:

- Artifact references in `session inspect` are still implementation-shaped file/tool paths rather than operator-facing artifact summaries.

What was confusing:

- Despite strong artifacts, clear audit posture, and trace continuity, the session still stops at `verification_incomplete` and `review_ready`.
- The difference between “good evidence present” and “not yet verified” is correct, but still reads slightly conservative without stronger operator framing.

What should change:

- Improve artifact summary wording before deeper artifact UX work.
- Continue validating whether the verification ladder is too dominated by missing policy evaluation.

### Session Record: ses_32a18961dffe6EB7pyv1b4k2Lw

Task:

```text
Quick greeting
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- The system remained consistent even on trivial sessions.
- `session inspect` correctly showed no artifacts, no approvals, and a minimal timeline.

What slowed the workflow:

- Trivial sessions still require the same surface sequence to understand why they are not more ready.

What was confusing:

- Stage, verification, and readiness all exist for a greeting session, which may be more architectural consistency than operator value.

What should change:

- Use more real sessions before deciding whether trivial sessions need different presentation or filtering.

## Evidence Log

| Session | Issue | Surface | Severity |
| ------- | ----- | ------- | -------- |
| ses_328ed3310ffe50coOPafJELC5f | `review_ready` feels optimistic for artifact-free conversational work | release check | medium |
| ses_328ed3310ffe50coOPafJELC5f | `stage: review` feels semantically weak for lightweight chat-like sessions | session show | low |
| ses_32d662276ffervMwsjjDxy68o2 | verification incompleteness wording repeats across read-only sessions | verify | medium |
| ses_32d662276ffervMwsjjDxy68o2 | navigation between summary and explanation still depends on command recall | session show / inspect / verify | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | artifact references remain too implementation-shaped | session inspect | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | strong evidence still ends in `review_ready`, which may under-communicate progress | verify / release check | medium |
| ses_32a18961dffe6EB7pyv1b4k2Lw | trivial sessions produce governance output with limited operator value | session show / inspect / verify | low |

## Batch 001 Pattern Summary

- The system is internally consistent across very different session shapes.
- Navigation between `show`, `inspect`, `verify`, and `release check` is functional but still recall-driven.
- Verification and readiness remain conservative, with missing policy evaluation dominating outcomes.
- Artifact-heavy sessions already feel substantially better than lightweight sessions, but artifact wording still needs translation into operator language.
- Trivial conversational sessions likely need later presentation tuning, but not a model change yet.

## Evaluation Batch 002

This batch adds deliberate edge cases: an interrupted near-empty run, a planning-only session, and a repeated verification/readiness stability check.

### Commands Used

```text
dax run -m google-vertex/gemini-2.5-flash
dax plan -m google-vertex/gemini-2.5-flash
dax session show <session-id>
dax session inspect <session-id>
dax verify <session-id>
dax release check <session-id>
```

### Session Record: ses_32889a3c9ffehYufvJ3CIjqFSr

Task:

```text
Edge case: empty session
```

Outcome:

```text
Outcome: active
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- `session show` and `session inspect` clearly exposed that the run never reached completion.
- `verify` and `release check` remained stable even for an incomplete session.

What slowed the workflow:

- The run path did not terminate cleanly after a simple no-tool response.

What was confusing:

- The model produced a clear one-line answer, but the session remained `active` with only `session_created` and `execution_started` in the timeline.
- `release_ready` did not fail hard because the session still had no explicit blocking factors, only missing evidence.

What should change:

- Observe whether incomplete active sessions should produce a stronger readiness downgrade once more evidence accumulates.
- Investigate why `dax run` can leave lightweight sessions active after a visible assistant response.

### Session Record: ses_32888c8ecffeQ1UE2gawdGQO5p

Task:

```text
Edge case: planning only
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- `dax plan` returned a coherent structured preview and produced a clean completed session.
- `session inspect` remained readable on a planning-only record.

What slowed the workflow:

- Planning output was machine-readable and useful, but post-plan navigation still depends on manually moving into `show`, `inspect`, `verify`, and `release check`.

What was confusing:

- A planning-only session ends in `stage: review`, which suggests the stage derivation still compresses planning-only work into a later lifecycle label.

What should change:

- Keep watching whether planning-only sessions need more specific stage derivation before changing the model.

### Stability Record: ses_32ddd10fbffe6xBlnTvYtoTxF3

Task:

```text
Repeated verification and release checks on an artifact-heavy session
```

Outcome:

```text
Verification run 1: verification_incomplete
Verification run 2: verification_incomplete
Release run 1: review_ready
Release run 2: review_ready
```

What worked well:

- Repeated `verify` output remained identical across runs.
- Repeated `release check` output remained identical across runs.
- No transient lock or drift appeared during the repeated checks on this session.

What slowed the workflow:

- Repeating the checks provides no additional affordance or summary for comparison; stability had to be inferred manually.

What was confusing:

- The system is stable here, but nothing in the output explicitly says the judgment is cached, unchanged, or freshly recomputed.

What should change:

- No immediate change. This is a stability confirmation, not yet a product gap.

## Evidence Log

| Session | Issue | Surface | Severity |
| ------- | ----- | ------- | -------- |
| ses_328ed3310ffe50coOPafJELC5f | `review_ready` feels optimistic for artifact-free conversational work | release check | medium |
| ses_328ed3310ffe50coOPafJELC5f | `stage: review` feels semantically weak for lightweight chat-like sessions | session show | low |
| ses_32d662276ffervMwsjjDxy68o2 | verification incompleteness wording repeats across read-only sessions | verify | medium |
| ses_32d662276ffervMwsjjDxy68o2 | navigation between summary and explanation still depends on command recall | session show / inspect / verify | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | artifact references remain too implementation-shaped | session inspect | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | strong evidence still ends in `review_ready`, which may under-communicate progress | verify / release check | medium |
| ses_32a18961dffe6EB7pyv1b4k2Lw | trivial sessions produce governance output with limited operator value | session show / inspect / verify | low |
| edge-session-run | default `dax run` model path failed before useful execution and required manual provider override | run | high |
| ses_32889a3c9ffehYufvJ3CIjqFSr | lightweight `dax run` session remained active after visible assistant response | run / session inspect | high |
| ses_32888c8ecffeQ1UE2gawdGQO5p | planning-only work still maps to `stage: review`, weakening stage semantics | session show / inspect | medium |

## Batch 002 Pattern Summary

- The default `run` path in this environment is not reliable enough for evaluation without an explicit model override.
- Planning completes more cleanly than lightweight `run` in the current setup.
- Repeated `verify` and `release check` calls are stable on an artifact-heavy session.
- Stage derivation still appears too eager to end at `review` for non-artifact, non-governance-heavy sessions.
- The biggest new signal is operational stability in `run`, not a new information-architecture gap.

## Evaluation Batch 003

This batch extends the edge cases into governance and lifecycle failure territory: a write-intent session, a planning-only session, and another interrupted lightweight `run`.

### Commands Used

```text
dax run -m google-vertex/gemini-2.5-flash
dax plan -m google-vertex/gemini-2.5-flash
dax session list
dax session show <session-id>
dax session inspect <session-id>
dax verify <session-id>
dax release check <session-id>
```

### Session Record: ses_32881fdd6ffeiIsGcNoiuuhl35

Task:

```text
Edge case: approval required write
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- The session was recorded and could be revisited through `show`, `verify`, and `release check`.
- The system remained structurally consistent after a write-intent task.

What slowed the workflow:

- `session inspect` hit `database is locked` for this session during evaluation.

What was confusing:

- No approval gate appeared for a write-intent task.
- The requested file was not present afterward in `artifacts/eval-approval/note.txt`.
- The session still completed with no approval or artifact evidence, which makes the write path hard to trust.

What should change:

- Keep collecting evidence, but this is the strongest governance-control signal so far.
- Revisit write approval semantics and completion semantics if this pattern repeats.

### Session Record: ses_32888c8ecffeQ1UE2gawdGQO5p

Task:

```text
Edge case: planning only
```

Outcome:

```text
Outcome: completed
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- Planning continues to complete cleanly under the explicit `google-vertex/gemini-2.5-flash` model path.
- The planning surface is still more stable than lightweight `run`.

What slowed the workflow:

- The operator still has to navigate manually into later inspection surfaces to understand session status.

What was confusing:

- Planning-only work still ends at `stage: review`, reinforcing that stage derivation is too generous for low-complexity sessions.

What should change:

- No immediate change. Keep validating stage semantics across more planning-only and execution-light sessions.

### Session Record: ses_32889a3c9ffehYufvJ3CIjqFSr

Task:

```text
Edge case: empty session
```

Outcome:

```text
Outcome: active
Stage: review
Verification: verification_incomplete
Readiness: review_ready
```

What worked well:

- The session model preserved the incomplete lifecycle cleanly enough to inspect later.

What slowed the workflow:

- The run produced visible assistant output but did not resolve to completion.

What was confusing:

- The timeline stopped at `execution_started`, but the user-facing run produced an answer.
- Readiness remained `review_ready` rather than communicating a harder interruption or abandonment state.

What should change:

- Keep focusing on run lifecycle semantics as the likely next product layer if this repeats.

### Stability Record: repeated verify and release checks on ses_32ddd10fbffe6xBlnTvYtoTxF3

Outcome:

```text
Verification: stable across repeated runs
Release check: stable across repeated runs
```

What worked well:

- Repeated trust and readiness checks stayed identical.
- No new drift appeared in the artifact-heavy, governed path.

What should change:

- Nothing yet. This remains a positive control case.

## Evidence Log

| Session | Issue | Surface | Severity |
| ------- | ----- | ------- | -------- |
| ses_328ed3310ffe50coOPafJELC5f | `review_ready` feels optimistic for artifact-free conversational work | release check | medium |
| ses_328ed3310ffe50coOPafJELC5f | `stage: review` feels semantically weak for lightweight chat-like sessions | session show | low |
| ses_32d662276ffervMwsjjDxy68o2 | verification incompleteness wording repeats across read-only sessions | verify | medium |
| ses_32d662276ffervMwsjjDxy68o2 | navigation between summary and explanation still depends on command recall | session show / inspect / verify | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | artifact references remain too implementation-shaped | session inspect | medium |
| ses_32ddd10fbffe6xBlnTvYtoTxF3 | strong evidence still ends in `review_ready`, which may under-communicate progress | verify / release check | medium |
| ses_32a18961dffe6EB7pyv1b4k2Lw | trivial sessions produce governance output with limited operator value | session show / inspect / verify | low |
| edge-session-run | default `dax run` model path failed before useful execution and required manual provider override | run | high |
| ses_32889a3c9ffehYufvJ3CIjqFSr | lightweight `dax run` session remained active after visible assistant response | run / session inspect | high |
| ses_32888c8ecffeQ1UE2gawdGQO5p | planning-only work still maps to `stage: review`, weakening stage semantics | session show / inspect | medium |
| ses_32881fdd6ffeiIsGcNoiuuhl35 | write-intent session produced no approval gate and no retained artifact | run / governance | high |
| ses_32881fdd6ffeiIsGcNoiuuhl35 | `session inspect` hit `database is locked` during evaluation | session inspect | high |

## Batch 003 Pattern Summary

- Artifact-heavy trust and readiness checks remain the most stable path in DAX.
- Lightweight `run` remains the weakest lifecycle surface.
- Write-intent execution now raises a stronger governance concern than simple navigation friction:
  - no visible approval gate
  - no resulting file
  - completed session anyway
- `plan` continues to be more reliable than `run` for low-complexity work.
- Runtime lifecycle clarity is now a stronger emerging next layer than UI design.
