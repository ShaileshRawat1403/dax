# DAX Session Progress Layers

## Purpose

Keep session progression surfaces legible as DAX grows by separating:

- live execution narration
- structured session progression
- trust evaluation

This document defines a hard product rule:

- transcript narrates execution
- timeline summarizes meaningful progression
- verification evaluates trust

## Layer 1: Transcript

### Operator question

What is happening right now?

### Role

The transcript is the live execution story.

It is:

- present-tense
- narrative
- execution-centered
- best suited for the main workstation activity pane

### Examples

- Planning workflow
- Running dependency scan
- Awaiting approval
- Producing artifact

### What belongs here

- active execution narration
- current step wording
- short progress updates
- immediate interruptions such as awaiting approval

### What does not belong here

- structured history browsing
- grouped session milestones
- verification judgments

## Layer 2: Timeline

### Operator question

What meaningful progression happened in this session?

### Role

The timeline is the structured progression view.

It is:

- chronological
- session-centered
- sparse by design
- inspect-first
- best suited for the CLI timeline surface and later workstation drilldowns

### Examples

- Session created
- Plan generated
- Approval requested
- Approval granted
- Artifacts produced
- Audit issue detected
- Trust posture changed

### What belongs here

- meaningful lifecycle transitions
- approvals that change execution state
- grouped artifact production
- important trust posture changes
- major session progression markers

### What does not belong here

- token streaming
- internal retry chatter
- low-level tool updates
- one entry per small implementation event
- detailed verification checks

## Layer 3: Verification

### Operator question

Why should I trust this session state?

### Role

Verification is the trust-judgment layer.

It is:

- judgment-oriented
- evidence-oriented
- trust-centered
- best suited for audit, verify, and later release-readiness surfaces

### Examples

- Approval completeness: pass
- Artifact completeness: warn
- Findings resolution: fail
- Trace continuity: pass
- Verification result: incomplete

### What belongs here

- completeness checks
- policy compliance evaluation
- findings resolution status
- override justification evaluation
- verification outcomes that affect trust posture

### What does not belong here

- live execution narration
- chronological session storytelling
- artifact browsing

## Separation Rule

Use this filter for every surfaced event or signal:

- Is this live narration of ongoing work?
  - transcript
- Is this a meaningful session milestone or progression marker?
  - timeline
- Is this a judgment about evidence, compliance, or trust?
  - verification

If a signal does not clearly fit one layer, do not expose it until the operator role is clear.

## Common Failure Modes To Avoid

### 1. Timeline becomes a dumping ground

If transcript chatter, low-level ledger events, and verification detail all enter the timeline, it becomes:

- noisy
- repetitive
- unreadable

### 2. Audit owns too much

If audit becomes history browser, artifact browser, and trust engine all at once, it loses its product role as the trust surface.

### 3. Transcript becomes pseudo-history

If the activity pane starts carrying full session history, it stops serving as the live execution story.

## Product Consequences

This separation implies:

- the workstation center should stay transcript-first
- timeline should arrive as a drilldown or secondary session surface, not the main center pane
- verification should remain distinct from both activity and timeline

## Guidance For Timeline Refinement

During the current CLI timeline refinement pass:

- keep progression markers in timeline
- keep chatter in transcript
- keep trust judgments in verification

### Keep in timeline

- session created
- plan generated
- execution started
- approval requested
- approval resolved
- artifacts produced
- audit issue detected
- trust posture changed
- verification completed

### Keep out of timeline

- token chunks
- internal retries
- low-level ledger updates
- repeated artifact rows unless grouped
- detailed verification results

### Move to verification instead

- approval completeness passed
- evidence incomplete
- trace continuity failed
- release-ready judgment

## Summary

DAX should keep three session-facing layers distinct:

- transcript for execution story
- timeline for meaningful progression
- verification for trust judgment

That separation keeps the CLI, workstation, and future history or release surfaces legible as the product grows.
