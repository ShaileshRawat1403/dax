# DAX Workstation Sidebar Spec

This document defines the sidebar contract for the balanced DAX workstation.

It assumes the previously chosen layout invariant:

- center = time-based execution story
- sidebar = state-based operator truth
- overlays = evidence and depth

The goal of the sidebar is not to explain everything.

The goal is to keep the operator oriented with a compact set of durable facts that remain visible while work is running.

## Sidebar Purpose

The sidebar should answer:

- what state the session is in
- where the session is in the lifecycle
- whether the session is trustworthy
- whether the session is ready
- whether something is waiting on the operator
- what durable outputs exist
- how writes were governed

It should not become:

- a second stream
- a verification report
- an audit dashboard
- a cluttered metric panel

## Sidebar Invariant

Every sidebar card must represent a durable session fact, not a reasoning trace.

Allowed:

- lifecycle state
- stage
- trust posture
- release readiness
- approvals count
- retained artifact count
- write-governance summary

Not allowed:

- long explanations
- raw verification findings
- audit rule details
- artifact inventories
- policy evidence dumps

## Card Order

The sidebar order is fixed:

1. `Lifecycle`
2. `Stage`
3. `Trust`
4. `Release`
5. `Approvals`
6. `Artifacts`
7. `Write governance`

This order is intentional.

It follows the operator sequence:

1. what state the session is in
2. where it is in the workflow
3. whether it is trustworthy
4. whether it is ready
5. whether the operator must act
6. what was produced
7. how writes were governed

## Card States

Each card should support only these visual states:

- `normal`
- `warning`
- `critical`
- `success`

No extra visual nuance should appear inside the base card.

Why:

- too much nuance turns the sidebar into a dashboard
- detailed reasoning belongs in overlays
- the operator should be able to scan the sidebar in one pass

## Card Rules

## 1. Lifecycle

Purpose:

- show the current session lifecycle truth

Examples:

- `Active`
- `Completed`
- `Interrupted`
- `Blocked`

State rules:

- `normal` for stable non-terminal work like `Active`
- `warning` when reconciliation or interruption exists
- `success` for clean completion
- `critical` only if lifecycle indicates failure/blockage severe enough to stop the session

Interaction:

- non-clickable in the first version

Rationale:

Lifecycle currently has no dedicated sidebar drilldown worth exposing on its own.

## 2. Stage

Purpose:

- show where the session currently sits in the SDLC progression

Examples:

- `Planning`
- `Implementation`
- `Verification`
- `Review`

State rules:

- always `normal` unless a future product reason exists to emphasize a stage boundary

Interaction:

- non-clickable in the first version

Rationale:

Stage is orientation, not an action surface.

## 3. Trust

Purpose:

- show the current trust posture concisely

Examples:

- `Clear`
- `Review needed`
- `Degraded`
- `Failed`

State rules:

- `normal` for neutral/incomplete posture
- `warning` for review-needed or degraded posture
- `critical` for failed trust
- `success` only when trust is genuinely clean

Interaction:

- opens the `verify` overlay

Rationale:

Trust is one of the most important default truths, but its explanation belongs in the verification drilldown.

## 4. Release

Purpose:

- show the current readiness posture

Examples:

- `Not ready`
- `Review ready`
- `Handoff ready`
- `Release ready`

State rules:

- `normal` for neutral in-progress readiness
- `warning` for review-needed or incomplete readiness
- `critical` for blocked/not-ready states caused by strong blockers
- `success` only for truly earned readiness

Interaction:

- opens the `release` overlay

Rationale:

Readiness must be visible, but the reasons should stay in the release drilldown.

## 5. Approvals

Purpose:

- show whether the operator is needed right now

Examples:

- `0 pending`
- `1 pending`
- `2 pending`
- `Blocked`

State rules:

- visually quiet when `0 pending`
- `warning` when pending approvals exist
- `critical` when denial/blockage requires attention
- never use `success`

Interaction:

- opens approvals overlay only when pending or blocked approval state exists
- otherwise may remain non-clickable or open a quiet review surface later

Rationale:

Approvals should not feel noisy when nothing is waiting.

## 6. Artifacts

Purpose:

- show whether durable outputs exist

Examples:

- `0 retained`
- `3 retained`
- `7 retained`

State rules:

- `normal` in most cases
- `warning` only when artifact absence is unexpectedly meaningful for the current workflow
- `success` can be used sparingly when retained outputs are complete and materially useful

Interaction:

- opens the artifacts overlay

Rationale:

Artifacts are important session truth, but inventories belong in the overlay.

## 7. Write Governance

Purpose:

- show the current write-governance summary in operator language

Examples:

- `None`
- `Governed completed write`
- `Completed ungated write`
- `Partial write`
- `Blocked write`
- `No durable result`

State rules:

- `normal` for no-write or harmless outcomes
- `warning` for incomplete or ungated-but-not-severe outcomes
- `critical` for unsafe or strongly governed write failures
- `success` only for clearly governed successful writes

Interaction:

- opens `inspect` or `verify` overlay

Rationale:

Write governance is now stable enough to show by default, but the evidence trail belongs in deeper surfaces.

## Warning and Emphasis Rules

The sidebar should use emphasis only when state worsens.

That means:

- do not highlight neutral cards aggressively
- do not keep `Approvals` noisy at `0 pending`
- do not use bright states everywhere at once

Practical rule:

- at most 1-2 cards should feel visually urgent at any given time unless the session is genuinely in trouble

## Clickability Rules

Initial clickable mapping:

- `Trust` -> verify overlay
- `Release` -> release overlay
- `Artifacts` -> artifacts overlay
- `Write governance` -> inspect or verify overlay
- `Approvals` -> approvals overlay when pending

Initial non-clickable cards:

- `Lifecycle`
- `Stage`

Why:

- only make cards clickable when a real drilldown exists
- avoid fake affordances
- keep the first sidebar version disciplined

## Refined Sidebar Mockup

```text
RIGHT SIDEBAR
--------------------------------

Lifecycle
Active

Stage
Verification

Trust
Review needed

Release
Review ready

Approvals
0 pending

Artifacts
3 retained

Write governance
Governed completed write
```

## Relationship to Other Surfaces

The sidebar is not a replacement for:

- `session show`
- `session inspect`
- `verify`
- `release check`

Instead:

- `session show` remains the compact CLI truth surface
- `session inspect` remains the deeper explanatory surface
- `verify` remains the trust judgment surface
- `release check` remains the readiness judgment surface

The sidebar borrows the most important top-level truths from those surfaces and keeps them visible during active work.

## Non-Goals

This document does not:

- define center-stream content in detail
- define overlay layout
- define footer shortcuts
- reopen workstation pane architecture

## Success Signal

The sidebar design is correct when:

- operators can scan it in seconds
- it remains calm during normal work
- it becomes prominent only when attention is needed
- it never competes with the center stream
- every clickable card leads to a meaningful drilldown
