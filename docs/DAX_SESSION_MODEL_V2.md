# DAX Session Model V2

## Purpose

Define what a DAX session is as a durable runtime object.

A session is not just:

- a CLI invocation
- a TUI screen
- a stream of messages

A session is the accountable operational object that binds:

- intent
- plan
- execution
- approvals
- artifacts
- audit posture

into one continuous work lifecycle.

This model should remain stable across CLI, TUI, and any future web workstation.

## Working Definition

**A DAX session is a governed execution record that turns AI-assisted work into an auditable lifecycle.**

This definition matters because trust, artifacts, approvals, and future release-readiness logic should attach to the session, not to isolated commands.

## Design Principles

- Sessions are runtime primitives, not UI constructs.
- Sessions own lifecycle continuity across planning, execution, interruption, and completion.
- Sessions are the attachment point for artifacts and trust evidence.
- Sessions should be durable enough to support review, handoff, replay, and future verification.
- UI and CLI surfaces should render sessions, not redefine them.

## Session Identity

Every session should have a stable identity layer.

Required identity fields:

- `session_id`
- `workspace`
- `created_at`
- `updated_at`
- `initiator`
- `intent_summary`

Optional identity fields:

- `parent_session_id`
- `branch_or_ref`
- `project_profile`
- `operator_label`
- `handoff_target`

## Session Lifecycle

The session lifecycle should be explicit and product-facing.

Recommended lifecycle:

- `created`
- `planning`
- `ready`
- `executing`
- `awaiting_approval`
- `blocked`
- `completed`
- `failed`
- `archived`

### Lifecycle Semantics

- `created`: session exists, but work definition is still minimal
- `planning`: intent is being turned into executable work
- `ready`: plan exists and the session is ready to proceed
- `executing`: work is actively running
- `awaiting_approval`: the session is paused for an operator decision
- `blocked`: execution cannot safely continue without correction or recovery
- `completed`: work reached a terminal success state
- `failed`: work ended unsuccessfully
- `archived`: session is retained for reference but no longer active

## Session Structure

A session should contain these logical layers:

- `intent`
- `plan`
- `steps`
- `activity_timeline`
- `approvals`
- `artifacts`
- `audit_findings`
- `trust_posture`

### Intent

Intent captures:

- what the operator asked for
- what work objective DAX inferred
- any explicit constraints or goals

### Plan

Plan captures:

- structured work definition before execution
- proposed steps
- readiness state
- current step focus

### Steps

Steps capture:

- ordered execution units
- step status
- current step
- completion or failure markers

### Activity Timeline

The timeline captures:

- meaningful events in the work lifecycle
- planning transitions
- execution transitions
- approvals and interruptions
- artifact production
- trust-relevant updates

The timeline should become the future backbone for replay and review.

### Approvals

Approvals capture:

- what required operator intervention
- why intervention was required
- whether the action was approved, denied, or overridden
- when the decision occurred

### Artifacts

Artifacts capture:

- retained work outputs
- their relationship to the session
- enough metadata for inspection and later lineage

### Audit Findings

Audit findings capture:

- trust-relevant issues
- severity
- category
- blocking status
- recommended next action

### Trust Posture

Trust posture captures the current operator-facing trust summary of the session.

In V2, trust posture remains a session-level property rather than a standalone subsystem.

## Session Outcomes

Sessions should end in explicit result states, not implied ones.

Recommended outcome set:

- `completed`
- `completed_with_overrides`
- `blocked`
- `failed`
- `aborted`

### Outcome Semantics

- `completed`: session finished successfully without unresolved trust or policy concerns
- `completed_with_overrides`: work completed, but one or more overrides materially affected trust posture
- `blocked`: session could not proceed safely
- `failed`: execution attempted but ended unsuccessfully
- `aborted`: session ended intentionally before natural completion

## Session As System Of Record

If DAX is to become an accountable execution system, the session must become the primary system-of-record object.

That implies future features should attach to sessions:

- timeline replay
- review handoff
- release readiness
- audit verification
- artifact lineage
- override traceability

## Relationship To Current DAX Grammar

The current grammar already maps cleanly onto the session:

- `plan` defines session work
- `run` advances session execution
- `approvals` exposes session checkpoints
- `artifacts` exposes session outputs
- `audit` exposes session trust posture

That means the command system is already session-shaped. V2 makes that shape explicit.

## Non-Goals

This document does not define:

- session history UI
- timeline UI
- session resume implementation
- artifact lineage implementation
- audit verification commands
- release readiness implementation

Those are consequences of the session model, not part of the model definition itself.

## Recommended Next Documents

After this model, the next design artifacts should likely be:

- `DAX_SESSION_TIMELINE.md`
- `DAX_TRUST_MODEL.md`

The timeline should define how session events are structured over time.
The trust model should define how evidence and posture attach to the session.

## Guiding Sentence

**DAX is a governed execution system that turns AI-assisted work into auditable sessions.**
