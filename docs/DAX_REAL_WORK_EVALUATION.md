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
