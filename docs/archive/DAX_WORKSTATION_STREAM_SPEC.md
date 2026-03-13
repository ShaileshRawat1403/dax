# DAX Workstation Stream Spec

This document defines the center stream contract for the balanced DAX workstation.

It applies the already chosen workstation invariant:

- center = narrative
- sidebar = truth
- overlays = evidence

The stream exists to tell the operator what is happening in time.

It does not exist to explain every judgment the system can make.

## Stream Purpose

The center stream should answer one question:

What just happened?

More precisely, it should show:

- actions in progress
- workflow transitions
- interruptions that require attention
- short outcome signals

It should not answer:

- why trust is degraded
- why release is blocked
- what the artifact inventory contains
- which policy rule failed

Those belong in the sidebar or overlays.

## Stream Invariant

Every line in the center stream must represent an event in time, not a standing judgment.

Allowed:

- action started
- action completed
- stage changed
- approval requested
- execution resumed
- artifact written

Not allowed:

- trust explanation
- readiness explanation
- policy reasoning
- artifact listings
- audit detail

## Allowed Message Classes

Only the following message classes belong in the stream.

## 1. Execution Steps

Definition:

- actions the system is actively performing

Examples:

```text
Planning workflow
Collecting repository signals
Running dependency scan
Producing report artifact
```

Rules:

- should use active, concrete verbs
- should describe one current action at a time
- should avoid embedding policy or trust judgment

## 2. Progress Transitions

Definition:

- state transitions that move the workflow forward

Examples:

```text
Plan completed
Entering verification stage
Execution resumed
```

Rules:

- must represent meaningful forward motion
- should be brief
- should not restate persistent sidebar truth

## 3. Interruptions

Definition:

- events that require operator attention or pause execution flow

Examples:

```text
Approval required for project write
Execution paused
Tool failure detected
```

Rules:

- interruptions should appear inline in the stream
- they should stand out visually from ordinary execution lines
- they should point the operator to the correct drilldown or action surface

Interaction example:

```text
Approval required for project write
-> Press [p] to review approvals
```

## 4. Short Outcome Signals

Definition:

- compact end-of-step or end-of-action results

Examples:

```text
Artifact written: dependency-report.json
Verification finished
Run completed
```

Rules:

- outcomes must stay short and terminal
- outcomes should mark what changed, not explain what it means
- outcome lines should never expand into inventories or long reasoning blocks

## Forbidden Message Classes

The following content must never live in the center stream.

## 1. Governance Reasoning

Bad:

```text
Verification incomplete due to missing policy evidence
```

Correct location:

- sidebar summary
- verify overlay

Why:

- this is a standing judgment, not an event in time

## 2. Artifact Inventories

Bad:

```text
Artifacts:
- summary.txt
- notes.md
- result.json
```

Correct location:

- artifacts overlay

Why:

- inventories are evidence, not stream narrative

## 3. Release Readiness Explanation

Bad:

```text
Release blocked due to policy gap
```

Correct location:

- release overlay
- release sidebar card as a compact state only

Why:

- readiness reasoning is judgment, not narrative

## 4. Audit or Policy Detail

Bad:

```text
Policy rule missing_tests failed
```

Correct location:

- verify overlay
- audit overlay

Why:

- rule-level evaluation belongs in drilldown surfaces

## Interruption Behavior

Interruptions are the one place where governance can temporarily enter the stream, but only as an event requiring action.

Rules:

- interruption lines appear inline
- interruption lines should be more prominent than normal execution lines
- interruption lines should be short
- interruption lines should connect to the correct action or overlay

Good:

```text
Approval required for project write
-> Press [p] to review approvals
```

Good:

```text
Execution paused
-> Press [enter] to resume after review
```

Bad:

```text
Approval is required because governed project writes must not continue without visible governance evidence.
```

Why bad:

- it turns interruption into policy explanation

## Outcome Behavior

Outcome lines should mark what finished and stop there.

Good:

```text
Artifact written: dependency-report.json
Verification finished
Run completed
```

Bad:

```text
Artifact written: dependency-report.json
Artifacts:
- dependency-report.json
- dependency-summary.md
```

Bad:

```text
Verification finished with incomplete trust because policy evidence is missing.
```

Correct follow-up:

- update the relevant sidebar cards
- put the reasoning in overlays

## Stream Formatting Rules

The stream should feel like a calm chronological feed.

### Preferred qualities

- short lines
- active verbs
- concrete nouns
- visible progression
- interruptions that stand out clearly

### Avoid

- long explanatory sentences
- stacked subordinate clauses
- repeated restatement of status already visible in the sidebar
- detailed diagnostic dumps

## Refined Balanced Workstation Mockup

```text
LIVE STREAM
--------------------------------

Planning workflow
Collecting repository signals
Running dependency scan
Producing report artifact
Waiting for verification update
```

Notice what is absent:

- no reasoning
- no policy explanation
- no inventories
- no judgment detail

Only events in time.

## Relationship to Other Workstation Surfaces

The stream should work with the other surfaces like this:

- stream = what happened
- sidebar = what is true
- overlays = why it matters / what the evidence says

If the stream starts absorbing sidebar truth or overlay evidence, the workstation becomes noisy and hard to scan.

## Non-Goals

This document does not:

- define sidebar card styling
- define overlay layout
- define footer shortcut design
- define exact typography or color treatment

## Success Signal

The stream contract is correct when:

- the center reads like an execution narrative
- interruptions are obvious without becoming essays
- operators never need to parse policy detail in the center
- trust/readiness/governance logic stays out of the live story unless it arrives as an actionable interruption
