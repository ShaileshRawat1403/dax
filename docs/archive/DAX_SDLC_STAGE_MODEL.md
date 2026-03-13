# DAX SDLC Stage Model

This document defines how DAX should model SDLC stages as a higher-order grouping layer above session progression.

## Purpose

DAX already has:

- transcript for live execution
- timeline for meaningful progression
- verification and release readiness for judgment

The next abstraction is SDLC stage grouping.

SDLC stages should help operators understand where a session sits in a broader software delivery lifecycle without turning the transcript or timeline into a taxonomy dump.

## Operator Questions

The stage model should answer:

- What part of the software delivery lifecycle is this session in?
- Which stage has this session reached?
- Which timeline events belong to which stage?
- Is this session still exploring, implementing, reviewing, or preparing for release?

## Product Rule

Keep these layers separate:

- transcript = live execution
- timeline = meaningful progression
- stages = higher-order grouping over progression
- verification = trust judgment
- release readiness = operational judgment

Stages must not replace timeline events or live transcript narration.

## First Design Principle

SDLC stages should first appear in:

- session history
- timeline summaries
- release summaries
- inspection views

They should not first appear in the live execution stream.

## Stage Candidates

The initial stage model should stay broad and practical.

A useful first set is:

- `discovery`
- `planning`
- `implementation`
- `verification`
- `review`
- `release_preparation`

These are not strict workflow gates. They are operator-facing groupings over work progression.

## Stage Meanings

### `discovery`

Used when the session is still exploring, reading, or understanding the system.

Typical signals:

- repository inspection
- architecture review
- issue triage
- requirements clarification

### `planning`

Used when the session is structuring intended work before execution.

Typical signals:

- plan generated
- scope review
- readiness preview
- task breakdown

### `implementation`

Used when the session is performing changes or generating outputs as the main work.

Typical signals:

- execution started
- file edits
- command execution
- artifact production

### `verification`

Used when the session is checking whether outputs and execution are correct.

Typical signals:

- tests
- checks
- diff review
- validation artifacts
- verification command results

### `review`

Used when the session is waiting on or collecting human or governance judgment.

Typical signals:

- approval requested
- approval resolved
- audit findings surfaced
- trust posture changes

### `release_preparation`

Used when the session is being judged for handoff or shipping.

Typical signals:

- release readiness review
- artifact completeness review
- final audit / verification confirmation

## Derived vs Declared vs Hybrid

The first model should be hybrid, but heavily derived.

### Derived

Most stage assignment should come from existing session signals:

- timeline events
- audit posture
- verification result
- release readiness
- retained artifacts

### Declared

Operators may sometimes know the session intent early, but explicit stage declaration should not be required in v1.

### Hybrid

The likely long-term model is:

- derive stage from real signals by default
- allow optional user or workflow hints later

## Mapping From Existing Signals

The first stage model should map current events roughly like this:

- `session_created` -> `discovery`
- `plan_generated` -> `planning`
- `execution_started` -> `implementation`
- `artifact_produced` -> `implementation`
- `approval_requested` -> `review`
- `approval_resolved` -> `review`
- `audit_finding_recorded` -> `review`
- `trust_posture_changed` -> `review`
- verification result present -> `verification`
- release readiness present -> `release_preparation`

This mapping should remain a derived interpretation, not a rewrite of the timeline model.

## Stage Boundaries

Stages should be:

- broad
- stable
- operator-facing

They should not become:

- micro-phases for every tool action
- internal planner state labels
- low-level event categories

## Relationship To History

Stage grouping is especially valuable in history.

Examples:

- session list may later show dominant or latest stage
- session show may summarize current or final stage
- session inspect may group timeline events by stage

This is a natural next use after the current durable history surfaces.

## Relationship To Timeline

Timeline remains the source progression view.

Stage grouping should sit above it:

- timeline says what happened
- stages say what lifecycle area that progression belongs to

If stage grouping starts replacing concrete timeline events, the model has drifted too far.

## Relationship To Release Readiness

Release readiness is not itself a stage.

Instead:

- readiness evaluation typically happens in `release_preparation`
- readiness may depend on earlier `verification` and `review`

This distinction must stay clear.

## Non-Goals

The first stage model should not include:

- live stream stage injection
- workflow automation
- user-edited stage graphs
- cross-session stage analytics
- TUI redesign in the same slice

## Acceptance Signals

This model is successful when:

- operators can quickly infer where a session sits in SDLC
- stage labels feel broad and intuitive
- stage grouping helps history and timeline interpretation
- transcript, timeline, and judgment layers remain distinct

## Recommended Next Step

Use this model first in derived, inspect-first surfaces such as:

1. session history summaries
2. session timeline summaries
3. release-readiness summaries

Only after the grouping proves useful should it be exposed more prominently in the workstation.
