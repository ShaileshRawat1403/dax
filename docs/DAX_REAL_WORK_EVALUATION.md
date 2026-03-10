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
