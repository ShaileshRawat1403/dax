# DAX Workstation Timeline Surface

## Purpose

Define how session timeline should appear in the workstation without competing with the live `Activity` surface.

The workstation timeline surface exists to:

- expose meaningful session progression in structured form
- let operators reconstruct what happened without leaving the session
- complement the live execution story rather than replacing it

## Operator Questions

The workstation timeline surface should answer:

- What happened in this session so far?
- In what order did the major milestones occur?
- Where did approvals, artifacts, and trust changes happen?
- Which milestones materially changed session state?

## Placement Decision

### Chosen v1 placement

Timeline should enter the workstation as an overlay or drilldown surface.

This is the recommended first shape because it:

- preserves `Activity` as the center of gravity
- avoids adding a second competing primary pane
- fits the existing normalized overlay model
- gives the operator a structured session-history view on demand

### Rejected v1 placements

#### Permanent pane next to Activity

Too early and too visually competitive with the live execution story.

#### Always-visible timeline card stack

Useful later as a summary entry point, but too limited for the first real workstation surface.

## Relationship To Existing Workstation Surfaces

### Activity

`Activity` answers:

- what is happening right now

Timeline answers:

- what meaningful progression has occurred so far

This separation must remain explicit.

### Audit

Timeline may show trust-relevant progression such as:

- audit issue detected
- trust posture updated

But detailed trust evaluation remains in `Audit` and later verification surfaces.

### Artifacts

Timeline may reference artifact production milestones.

Detailed retained output inspection remains in `Artifacts`.

### Approvals

Timeline may show:

- approval requested
- approval granted
- approval rejected

Detailed operator action remains in `Approvals`.

## Entry Points

The first workstation timeline surface should open from explicit operator intent.

Recommended v1 entry points:

- footer or help action for `timeline`
- keyboard shortcut dedicated to timeline drilldown
- optional session command entry from the shell or command palette

Deferred:

- automatic jumps from audit or artifacts
- always-visible timeline summary card

## Presentation Model

Each timeline row should reuse the canonical CLI timeline shape.

A visible row should include:

- timestamp
- event family label
- short operator-facing summary
- optional reference or grouped reference label
- optional state effect only when it materially clarifies progression

### Example rows

- `09:14 Approval granted`
- `09:16 Artifacts produced (3)`
- `09:17 Trust posture updated -> review_needed`
- `09:18 Execution completed`

## Density Rules

Carry forward the CLI timeline density rules into the workstation surface.

### Required rules

- no raw ledger dumping
- no live execution chatter
- no verification detail rows
- grouped artifacts stay grouped
- repeated low-signal rows stay collapsed

### Excluded from timeline surface

- token streaming
- internal retries
- low-level tool events
- detailed verification checks
- release-readiness judgment

## Overlay Behavior

Timeline should behave like a structured workstation subview.

### Required behavior

- opening timeline should not change session truth or focus ownership rules
- overlay should take precedence while open
- closing timeline should return the operator to the previously focused pane
- footer/help should switch to timeline-relevant actions while open

### Expected interaction style

- inspect-first
- read-only
- keyboard navigable
- no mutation or replay behavior in v1

## Visual Role

Timeline should feel structured and calm.

It should not look like:

- a raw log window
- a second activity transcript
- an audit findings pane

It should look like:

- a chronological progression summary for the session

## V1 Non-Goals

This surface should not yet include:

- replay engine
- cross-session comparison
- editable timeline
- verification controls
- release-readiness judgment
- full history browser

## Acceptance Signals

The workstation timeline surface is successful when an operator can:

- reconstruct the session’s major milestones quickly
- see where approvals, artifacts, and trust changes happened
- distinguish timeline from live activity without confusion
- enter and exit the timeline without disturbing normal workstation flow

## Summary

The strongest v1 decision is:

- timeline as a workstation overlay or drilldown

Not a permanent pane.

That keeps the workstation hierarchy intact:

- `Activity` remains the live execution story
- `Timeline` becomes an on-demand structured session-history surface
- `Audit` remains the trust surface
