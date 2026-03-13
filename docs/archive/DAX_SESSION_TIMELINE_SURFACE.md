# DAX Session Timeline Surface

## Purpose

Define how DAX should expose meaningful session progression to operators as a real product surface.

The timeline surface exists to:

- expose meaningful session progression
- show how work evolved over time
- connect actions, approvals, artifacts, and trust changes in one readable sequence

This surface should make session depth visible without dragging DAX prematurely into replay engines or release-readiness policy.

## Operator Question

The timeline surface should answer:

- `What happened in this session?`
- `In what order did it happen?`
- `What changed trust or state?`
- `What outputs or evidence appeared along the way?`

This is different from:

- transcript: `what is happening now?`
- audit: `can I trust this?`
- artifacts: `what outputs exist?`

The timeline answers:

- `how did this session progress?`

## First Surface Recommendation

The first timeline surface should be:

## CLI / Session Timeline Surface

Recommended reasons:

- lowest interaction risk
- easiest way to validate event density and event families
- cleanest bridge between runtime model and product surface
- avoids premature workstation complexity

Future surfaces may include:

- workstation drilldown
- audit-linked timeline view
- session history browser

But the first surface should stay narrow.

## Timeline Presentation Model

The visible timeline should emphasize:

- chronological progression
- event family labels
- concise summaries
- references to approvals, artifacts, findings, and trust changes
- visible state effects when meaningful

The visible surface should feel like structured progression, not like a log dump.

## Presentation Elements

Each visible timeline entry should ideally surface:

- timestamp or relative order
- event type
- concise summary
- linked object references where meaningful
- trust or lifecycle effect if the event materially changed state

Examples:

- `plan generated`
- `execution started`
- `approval requested`
- `artifact produced`
- `trust posture changed to review_needed`
- `session completed`

## Event Density Rules

The visible timeline must stay selective.

### Rule 1: Show Meaningful Session Progression Only

Do not render every raw internal event.

### Rule 2: Collapse Repetitive Low-Signal Activity

Repeated minor execution events should not dominate the visible timeline.

### Rule 3: Preserve References For Later Depth

Even when low-signal events are collapsed, enough references should remain available for deeper inspection later.

### Rule 4: Keep Trust-Relevant Changes Explicit

Approval moments, artifact creation, findings, and trust posture changes should appear clearly.

## Relationship To Transcript, Audit, And Artifacts

This separation must remain explicit.

### Transcript

- narrated execution story
- conversational and execution-adjacent

### Timeline

- structured session progression
- chronological and stateful

### Audit

- trust inspection surface
- explains current trust posture and findings

### Artifacts

- retained work outputs
- shows what exists, not the whole progression story

These surfaces should complement one another rather than duplicate each other.

## v1 Surface Shape

The first visible timeline surface should likely:

- list chronological session events
- use stable event family labels
- show concise summaries
- include references to approvals, artifacts, findings, and trust changes
- remain read-only and inspect-first

It should not yet attempt:

- replay controls
- cross-session views
- timeline editing
- release judgment

## v1 Non-Goals

This surface does not include:

- full history browser
- replay engine
- cross-session comparison
- release-readiness decisions
- verification actions
- raw ledger browsing as the primary experience

## Acceptance Signals

The timeline surface is successful when:

- an operator can reconstruct meaningful session progression
- approvals, artifacts, and trust changes appear in context
- the surface feels structured rather than log-like
- it complements the workstation instead of duplicating transcript noise

## Recommended Next Step

After this surface contract, the next practical move should be one of:

- a CLI timeline command or session subcommand
- a narrow workstation timeline drilldown once the CLI shape proves stable

The first implementation should validate:

- event density
- event family usefulness
- operator readability

before expanding into replay or release-readiness concerns.

## Guiding Rule

**The first timeline surface should expose meaningful session progression in a structured way, not turn DAX into a log viewer.**
