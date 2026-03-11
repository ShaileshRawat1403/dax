# DAX Workstation UI Blueprint

## Purpose

This blueprint maps the DAX execution model into a concrete operator workstation.

The goal is not to wrap CLI commands in panels. The goal is to create one session-centered workspace where operators can define work, observe execution, intervene when needed, inspect outputs, and review trust posture.

## Product Philosophy

DAX is not another AI assistant UI.

It is an operator workstation for governed AI execution.

The UI must make three things obvious:

- work is defined before execution
- execution is observable and interruptible
- trust and evidence are inspectable

## Core Operator Questions

The workstation should answer these questions at the same time:

1. what is this work?
2. what is happening now?
3. what needs my decision?
4. what was produced?
5. can I trust this run?

These questions map directly to the canonical grammar:

- `plan`
  - what work will happen?
- `run`
  - what is happening now?
- `approvals`
  - what needs my decision?
- `artifacts`
  - what was produced?
- `audit`
  - can I trust this run?

## Session-Centered Model

The session is the product unit.

The workstation should treat commands as actions inside the session lifecycle, not as isolated screens.

This means:

- the session header reflects current posture
- the transcript narrates execution progress
- approvals, artifacts, and audit remain visible alongside the session
- the plan stays accessible as the work definition layer

## Canonical Layout

### 1. Header

The header should expose current session state at a glance.

Show:

- session name
- current phase
- active step
- approval state
- trust posture

Example:

```text
Session: release-notes-workflow
Phase: awaiting approval
Step: generate notes
Trust: review needed
```

### 2. Main Transcript

The transcript is the execution narrative.

It should narrate work progression, not model internals.

Good transcript language:

- generating plan
- validating workflow
- executing step
- awaiting approval
- producing artifact
- updating trust posture

Avoid:

- model reasoning tokens
- low-level chain-of-thought style framing
- raw telemetry by default

### 3. Plan Surface

The plan surface should show the current work object.

It should answer:

- what is the intended work?
- what steps are proposed?
- is the plan ready, incomplete, or blocked?

This can live as:

- a left drawer
- a top secondary panel
- a collapsible session sidebar section

### 4. Approval Panel

The approvals panel is the intervention surface.

It should show:

- pending approvals
- requested action
- reason for the checkpoint
- related session or step

It should be interruptive only when action is required. Otherwise it should remain visible but calm.

### 5. Artifacts Panel

The artifacts panel is the output surface.

It should show:

- retained outputs
- output type or origin
- session linkage
- reference path or attachment hint

This panel answers:

- what work products exist?
- what can I inspect next?

### 6. Audit Panel

The audit panel is the trust surface.

It should show:

- approvals count
- overrides count
- evidence presence
- findings posture
- overall trust posture

This panel should summarize meaning first. Raw event history belongs behind drill-down.

## Golden Operator Flow

The workstation should guide the user through this flow:

1. plan
2. review
3. run
4. approve
5. inspect
6. audit

This is the key distinction from chat-first AI products.

The UI should never feel like:

- prompt
- answer
- done

It should feel like a governed work loop.

## Information Architecture

The ideal first workstation layout has five zones:

### Header

- session identity
- lifecycle phase
- trust posture

### Center Transcript

- execution narration
- current and past workflow progression

### Side Stack

- approvals
- artifacts
- audit

### Plan Drawer

- current work definition
- readiness state

### Command Bar

- quick actions for:
  - plan
  - run
  - review approvals
  - inspect artifacts
  - open audit detail

## UX Rules

### Rule 1: Narrate work, not thinking

The workstation should show workflow progression rather than model introspection.

### Rule 2: Interrupt only for real intervention

Blocking UI states should be reserved for:

- approvals
- policy denials
- execution failures

### Rule 3: Trust must always be inspectable

Approvals, artifacts, and audit posture should remain accessible without leaving the session context.

### Rule 4: Default surfaces should emphasize meaning

Use:

- trust posture
- next actions
- requested operation
- retained output

Avoid defaulting to:

- raw events
- internal IDs as primary labels
- debug-first wording

## Differentiators

The workstation should stand out in three ways.

### 1. Execution narration

DAX should show work progression, not assistant chatter.

### 2. Human control points

Approvals and overrides should be explicit and legible.

### 3. Inspectable trust

Trust should be reviewable through evidence-oriented summaries, not implied by confidence in the model.

## Near-Term Blueprint

### Phase 1: Normalize the existing TUI around the execution model

Use current TUI surfaces, but align them to the workstation roles:

- transcript = execution narrative
- artifact pane = retained outputs
- RAO pane = approvals and intervention
- audit pane = trust posture
- session header = current phase and active step

### Phase 2: Make the plan surface first-class

Ensure the plan is visible in-session as the current work object, not only as a command result.

### Phase 3: Add session posture summaries

The header and session shell should summarize:

- phase
- approval state
- artifact presence
- trust posture

### Phase 4: Add drill-down without polluting defaults

Experts should be able to reach:

- raw audit events
- detailed diffs
- deeper artifact references

But those should not become the default operator experience.

## Non-Goals

The workstation should not become:

- a dashboard-first admin console
- an IDE clone
- a chat UI with extra tabs
- a log viewer

The session remains the anchor.

## Success Criteria

The workstation is successful when an operator can understand, in one screen:

- what the work is
- what phase it is in
- whether anything needs approval
- what outputs exist
- whether the execution trail is trustworthy

If those questions require switching between unrelated tools or mental models, the workstation is not complete yet.
