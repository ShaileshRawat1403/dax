---
title: DAX Session Model V2
archetype: architecture
status: proposed
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - sessions
last_reviewed: 2026-08-19
---

# DAX Session Model V2

> **Status note**: this document is a design proposal. The durable-session
> principles and the command grammar it describes are real, but the
> "recommended lifecycle" vocabulary below is not the shipped enum. The
> implemented `SessionStatus` is
> `"active" | "paused" | "completed" | "abandoned" | "failed" | "blocked"`
> (`packages/dax/src/session/state-types.ts:143`).

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

A session is an **immutable stream of RunEvents**. The logical layers below are **projected** from this event stream to create the operational workstation view.

Logical Projection Layers:

- `intent`
- `plan`
- `steps`
- `narrative`
- `approvals`
- `artifacts`
- `interventions`
- `proposedChanges`
- `trust_posture`

### Intent

Intent captures:

- what the operator asked for
- what work objective DAX inferred
- any explicit constraints or goals

### Plan

Plan captures:

- structured work definition before execution
- proposed tasks and dependencies
- readiness state
- current task focus

### Narrative

The narrative projection collapses internal technical noise into a human-readable, operational feed. It ensures that the operator is always aware of the high-level progress and stage transitions.

### Steps

Steps capture:

- ordered execution units
- step status
- current step
- completion or failure markers

### Activity Timeline (The Event Log)

The timeline is the immutable backbone of the session. Every transition, approval, and discovery is recorded as a discrete event.

### Approvals

Approvals capture governance checkpoints where the operator must grant permission for a high-risk action.

### Interventions

Interventions identify specific operational blocks (ambiguity, recovery, risk escalation) that require human resolution. Unlike generic pauses, interventions are unique trackable entities.

### Proposed Changes (Speculative Preview)

Speculative previews allow operators to see exactly what a tool call (like `edit` or `apply_patch`) intends to do before granting approval.

### Artifacts

Artifacts capture:

- retained work outputs
- their relationship to the session
- enough metadata for inspection and later lineage

### Trust Posture

Trust posture captures the current operator-facing trust summary of the session, derived from audit finding events.

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
