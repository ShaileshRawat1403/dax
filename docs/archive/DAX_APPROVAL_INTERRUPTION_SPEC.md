# DAX Approval Interruption Spec

This document defines how approval interruptions should appear in the balanced DAX workstation.

It builds on the already locked workstation roles:

- stream = narrative
- sidebar = truth
- overlays = evidence

Approvals are the main class of interruption that can legitimately break normal execution flow.

The goal is to make them visible and actionable without turning the workstation into a modal approval console.

## Core Rule

Approvals are interruptions, not persistent state.

That means:

- the stream records the interruption event
- the sidebar reflects the ongoing pending state
- the approvals overlay is the decision surface

The stream must never become the decision UI.

## Approval Interruption Model

When approval is required:

1. the stream records the interruption
2. execution pauses
3. the sidebar reflects pending approval state
4. the operator opens the approvals overlay
5. approval or denial resumes or blocks execution

This keeps approval behavior aligned with the workstation architecture:

- narrative in stream
- truth in sidebar
- decision in overlay

## Stream Presentation

Approvals should appear in the stream as short interruption events.

Good example:

```text
Approval required for project write
Press [p] to review approvals
```

Good example:

```text
Approval required for shell execution
Press [p] to review approvals
```

Rules:

- short
- narrative
- action hint only
- no long reasoning

The stream records that approval was required.

It does not explain all policy logic behind the approval.

## Stream Follow-Up Events

After the operator responds, the stream may record short follow-up events.

Good:

```text
Approval granted
Execution resumed
```

Good:

```text
Approval denied
Execution blocked
```

These are still narrative events, not policy explanations.

## Forbidden Stream Behavior

The following must never appear in the stream.

### Long approval reasoning

Bad:

```text
Approval required because the write affects governed project files under policy rules and must be reviewed before continuing.
```

Correct location:

- approvals overlay

### Inline decision UI

Bad:

```text
Approve? (y/n)
```

Why bad:

- it collapses the workstation into a prompt-modal interaction
- it breaks the center/overlay separation

### Approval detail dumps

Bad:

```text
Pending approvals:
- write config/settings.json
- run shell command
```

Correct location:

- approvals overlay

## Sidebar Behavior

The `Approvals` card is the persistent indicator for approval state.

Example quiet state:

```text
Approvals
0 pending
```

Example warning state:

```text
Approvals
1 pending
```

Example critical state:

```text
Approvals
Blocked
```

Rules:

- quiet when no approval is pending
- warning when approvals are pending
- critical when denial or blockage leaves the session unable to continue
- never turn the sidebar card into the decision UI

The sidebar carries the durable truth:

- whether something is pending
- whether the session is blocked

It does not carry the approval form itself.

## Approval Overlay

The approvals overlay is the focused decision surface.

It should contain:

- approval request summary
- action being requested
- risk classification
- short reason
- decision options

Example:

```text
Approval request
--------------------------------

Action
Write file: config/settings.json

Risk
Governed project write

Reason
Write requires approval under policy

Options
[a] approve
[d] deny
[q] close
```

Rules:

- concise and decision-oriented
- enough context to make the decision
- no raw internals unless a future forensic mode is added

## Overlay Role

Important rule:

Overlay = decision surface
Stream = event surface

The stream should never absorb the overlay’s job.

## Execution Semantics

When an approval is required:

- lifecycle should reflect paused/blocked execution as appropriate
- stream records the interruption
- sidebar shows pending approval truth
- overlay becomes the place where the operator acts

Example narrative:

```text
Producing configuration update
Approval required for project write
Execution paused
```

After approval:

```text
Approval granted
Execution resumed
```

After denial:

```text
Approval denied
Execution blocked
```

## Keyboard Behavior

Recommended first shortcut:

- `p` -> approvals overlay

Rules:

- `p` should open the approvals overlay when pending approvals exist
- if no approvals are pending, `p` may do nothing or open a quiet empty state later
- inside the overlay:
  - `a` approves
  - `d` denies
  - `q` or `esc` closes the overlay

The broader approval workflow logic is out of scope here.

This spec only defines how the workstation presents it.

## Refined Approval Interaction Flow

```text
Stream
--------------------------------
Running dependency scan
Producing report
Approval required for project write
Execution paused

Sidebar
--------------------------------
Approvals
1 pending

Footer
--------------------------------
[p] approvals
```

Open overlay:

```text
Approval request
--------------------------------
Write file: report.json
Risk: governed project write

[a] approve
[d] deny
[q] close
```

## Relationship to Other Surfaces

Approvals should fit cleanly into the workstation without breaking its roles:

- stream records the moment of interruption
- sidebar carries the persistent pending/blocked state
- overlay handles the decision

This prevents:

- modal prompt clutter in the center
- dashboard clutter in the sidebar
- duplicated decision UI across surfaces

## Non-Goals

This document does not:

- redesign approval policy rules
- define detailed approval queue layouts for many simultaneous requests
- redesign the underlying governance engine
- define broader TUI styling

## Success Signal

Approval interruptions are correctly designed when:

- operators notice them immediately
- the stream remains readable
- the sidebar reflects ongoing approval state
- the overlay is the obvious place to act
- the workstation does not collapse into a modal approval UI
