# DAX TUI Workstation Architecture

## Purpose

This document translates the DAX execution model and workstation blueprint into a concrete terminal workstation architecture.

The goal is to make the TUI feel operational, not conversational. DAX should read as a running governed workflow, not a chatbot inside a terminal.

## Core UX Principles

### 1. Sessions are the center

The TUI should be organized around the session lifecycle.

Not:

- command -> output

But:

- session -> lifecycle -> state

### 2. Narrate work, not tokens

The TUI should show workflow progression:

- generating plan
- validating steps
- executing action
- awaiting approval
- producing artifact
- updating trust posture

It should not foreground model-thinking language.

### 3. Interrupt only for real operator decisions

Blocking or interruptive surfaces should be reserved for:

- approvals
- policy denials
- execution failures

Everything else should remain visible but non-blocking.

### 4. Trust must always be visible

Operators should always be able to inspect:

- approvals
- artifacts
- audit posture

These should not be hidden behind command-only flows.

## Information Architecture

The TUI should answer five operator questions at once.

| Operator question | CLI surface | TUI surface |
| --- | --- | --- |
| What work is defined? | `plan` | Plan pane |
| What is happening now? | `run` | Execution transcript |
| What needs my decision? | `approvals` | Approval panel |
| What outputs exist? | `artifacts` | Artifact panel |
| Can I trust this run? | `audit` | Audit panel |

This is the workstation contract.

## Recommended Layout

The recommended DAX TUI layout is a session workstation:

1. header
2. plan surface
3. central execution transcript
4. right sidebar stack:
   - approvals
   - artifacts
   - audit
5. action footer

In simple form:

```text
+----------------------------------------------------+
| DAX – Execution Control Plane                      |
| Session: repo-audit | Step: dependency scan        |
| State: awaiting approval | Audit: review needed    |
+----------------------------------------------------+

PLAN
------------------------------------------------------
Scan dependencies
Generate report
Produce artifact

TRANSCRIPT
------------------------------------------------------
Planning workflow
Validating steps
Executing dependency scan
Awaiting approval

RIGHT SIDEBAR
------------------------------------------------------
Approvals
Artifacts
Audit
```

## Pane Roles

### Header

The header is the posture strip.

It should show:

- session identity
- current lifecycle phase
- active step
- approval state
- trust posture

The header should answer:

- where am I?
- what phase is this session in?
- is anything blocked?

### Plan Pane

The plan pane is the work-definition surface.

It should show:

- workflow goal
- current plan steps
- current step highlight
- readiness or plan posture when relevant

Behavior:

- prominent before or at execution start
- collapsible or reduced after execution is underway

### Transcript

The transcript is the primary narrative surface.

It should tell the story of work:

- plan created
- validation complete
- step started
- approval required
- artifact produced
- trust posture updated

This is the center of the workstation.

### Approval Panel

The approval panel is the intervention surface.

It should show:

- pending approval count
- current requested operation
- reason for checkpoint
- related session or step
- approve / deny affordances

### Artifact Panel

The artifact panel is the output surface.

It should show:

- retained outputs
- source or origin
- session linkage
- reference hints

### Audit Panel

The audit panel is the trust surface.

It should show:

- approvals count
- overrides count
- evidence presence
- findings posture
- overall trust posture

This should remain summary-first. Raw event history should be drill-down, not default.

### Footer

The footer is the action lane.

It should surface:

- primary next action
- approval attention
- MCP or environment attention
- quick keyboard hints

It should not become a status dump.

## Existing TUI Mapping

The current TUI already has several usable foundations:

- header
- transcript-centered session route
- pane modes for artifact, diff, RAO, PM, and audit
- footer attention strip

Current mapping weaknesses:

- pane labels still reflect legacy/internal vocabulary
- `pm` currently maps to `plan` only loosely
- `artifact` is used as a generic context bucket
- `audit` remains partly docs-oriented in naming
- review state is present, but not yet shaped as a workstation sidebar stack

## Refactor Direction

### Rename by operator meaning, not subsystem name

Current:

- `artifact`
- `rao`
- `pm`
- `audit`

Desired operator-facing meanings:

- artifacts
- approvals
- plan
- audit

Internal names may remain temporarily, but visible labels should follow the workstation contract.

### Make the session shell posture-first

The session shell should surface:

- current phase
- current step
- approval state
- trust posture

before deep detail.

### Make plan explicit in-session

The plan should be visible as a work object during the session, not just as a command outcome.

### Keep review surfaces visible without overwhelming the center

The transcript stays central. The right stack stays compact and inspectable.

## Interaction Model

The workstation should support a few explicit actions well.

### Approval actions

- approve
- deny
- inspect request detail

### Artifact actions

- open artifact
- inspect reference

### Audit actions

- open trust detail
- inspect low-level events

### Navigation actions

- move between transcript and side panels
- expand current step
- reopen plan view

## State Model

The header and transcript should share a stable vocabulary for session state.

Recommended state labels:

- planning
- executing
- awaiting approval
- completed
- blocked
- failed

These labels should be used consistently across CLI, TUI, and docs.

## Visual Language

The terminal UI should use restrained but clear signals.

### Color posture

- green: clear / success
- yellow: awaiting approval / review needed
- red: blocked / failed
- blue: executing / active work

### Optional icons

- approval: warning marker
- artifact: success marker
- executing: active marker
- trust clear: verification marker

Icons should support scanning, not become decoration.

## Recommended Implementation Sequence

1. normalize visible pane labels to the workstation grammar
2. make header posture and active step explicit
3. make plan visible as a first-class session surface
4. reshape right-side panes into approvals, artifacts, and audit stack
5. keep raw details behind drill-down

This should happen before adding new TUI features.

## Success Criteria

The workstation is successful when an operator can tell, in one screen:

- what this session is trying to do
- what phase it is in
- whether anything needs a decision
- what outputs have been produced
- whether the execution trail is trustworthy

If those answers still require command memorization or subsystem knowledge, the TUI is not yet aligned.
