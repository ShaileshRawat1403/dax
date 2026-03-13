# DAX Session Timeline

## Purpose

Define the session timeline as a durable runtime structure that captures meaningful progression through a DAX session.

The timeline is not:

- a UI widget
- a raw event log
- a transcript replacement

The timeline is the session-native record of how governed work moved from intent to outcome over time.

## Working Definition

**A DAX session timeline is the append-oriented sequence of meaningful session events that explain how work progressed, where it paused, what it produced, and how its trust posture changed.**

This definition matters because future review, replay, handoff, verification, and release-readiness work should depend on the timeline as a stable runtime layer.

## Timeline Role

The timeline sits inside the session model as the progression layer across:

- session lifecycle
- planning and execution
- approvals and interruptions
- artifact production
- audit findings
- trust posture changes

Relationship to adjacent session layers:

- lifecycle states describe current session state
- the timeline explains how the session moved between those states
- artifacts attach concrete outputs to specific moments in the timeline
- audit findings attach trust-relevant issues to specific moments in the timeline
- trust posture changes should be explainable through timeline events

## Design Principles

- The timeline is a runtime primitive, not a UI construct.
- The timeline is append-oriented.
- Timeline events should favor operator meaning over raw telemetry.
- Not every ledger or internal event deserves a timeline entry.
- The timeline should be stable enough to support replay, review, and verification.
- Timeline entries should preserve enough context to explain why the session changed state.

## Timeline Event Types

Recommended first-class event families:

- `session_created`
- `plan_generated`
- `execution_started`
- `step_entered`
- `step_completed`
- `approval_requested`
- `approval_resolved`
- `artifact_produced`
- `audit_finding_recorded`
- `trust_posture_changed`
- `session_completed`
- `session_failed`
- `session_blocked`
- `session_aborted`

These event families are intentionally operator-facing.

They should answer:

- what happened?
- why did it matter?
- what changed in the session because of it?

## Event Semantics

### Session Created

Marks the beginning of the durable operational object.

Questions answered:

- when did the session begin?
- what workspace and intent did it begin with?

### Plan Generated

Marks the point where intent became structured work.

Questions answered:

- when did the session become plan-backed?
- what plan summary or readiness state emerged?

### Execution Started

Marks the transition from preparation into active work.

Questions answered:

- when did governed execution begin?
- what phase or step became active?

### Step Entered / Step Completed

Marks progression through meaningful work units.

Questions answered:

- what step became active?
- what step finished?
- where is the session currently progressing?

### Approval Requested / Approval Resolved

Marks pauses and operator intervention.

Questions answered:

- what required intervention?
- why was intervention required?
- how was the request resolved?

### Artifact Produced

Marks retained output becoming part of the session.

Questions answered:

- what reviewable output was produced?
- when did it become available?

### Audit Finding Recorded

Marks trust-relevant issues entering the session.

Questions answered:

- what trust concern appeared?
- how severe was it?
- did it block the session?

### Trust Posture Changed

Marks a material change in session trust.

Questions answered:

- how did session trust move?
- what caused it to improve or degrade?

### Session Completed / Failed / Blocked / Aborted

Marks terminal outcomes.

Questions answered:

- how did the session end?
- what was the last meaningful state of the work lifecycle?

## Event Structure

Each timeline event should carry a stable minimal shape.

Recommended fields:

- `event_id`
- `session_id`
- `timestamp`
- `type`
- `source`
- `summary`
- `references`
- `state_effect`

### Field Semantics

- `event_id`: stable identifier for the event
- `session_id`: session ownership
- `timestamp`: when the event occurred
- `type`: event family
- `source`: where the event originated
  - operator
  - runtime
  - tool
  - audit
  - governance
- `summary`: concise operator-facing description
- `references`: linked objects such as step ids, approval ids, artifact ids, or finding ids
- `state_effect`: what changed because of this event
  - lifecycle change
  - trust posture change
  - artifact count change
  - approval state change

## Timeline Rules

The timeline should follow a few strict rules.

### Rule 1: Append-Oriented

The timeline grows forward through meaningful events.

It should not behave like an editable narrative surface.

### Rule 2: Meaning Over Exhaust

Not every raw ledger event becomes a timeline entry.

Timeline events should represent meaningful operator-visible changes.

### Rule 3: Trust-Relevant Changes Must Be Explainable

If trust posture changes, the timeline should contain enough context to explain why.

### Rule 4: Outputs Must Attach To Time

Artifacts should not float outside the timeline.

The timeline should show when they entered the session lifecycle.

### Rule 5: Interruptions Must Be Visible

Approvals, blocks, and failures must appear as explicit timeline moments.

That is required for accountability.

## Relationship To Ledger Events

The ledger and the timeline are not the same thing.

- the ledger may contain raw execution detail
- the timeline contains session-meaningful progression

The timeline should be derived from or aligned with lower-level events where necessary, but it should not simply mirror raw telemetry.

## Relationship To Transcript

The transcript and the timeline are also not the same thing.

- the transcript is conversational and execution-adjacent
- the timeline is structured progression across the session lifecycle

The transcript may help explain context.
The timeline should explain stateful progression.

## Relationship To UI

The workstation and future views may render the timeline in different ways:

- activity pane
- replay view
- session history
- audit drilldown

But the UI does not own the timeline model.

The timeline should exist independently of any one surface.

## Non-Goals

This document does not define:

- timeline UI layout
- replay controls
- history browser UI
- raw ledger retention
- audit verification rules

Those should build on the timeline model later.

## Recommended Next Document

After this timeline model, the next natural design document is:

- `DAX_AUDIT_VERIFICATION.md`

That document should explain how session trust posture is checked, confirmed, or degraded using session state, evidence, and timeline-aware trust signals.

## Guiding Rule

**The session timeline should represent meaningful session progression, not raw event exhaust.**
