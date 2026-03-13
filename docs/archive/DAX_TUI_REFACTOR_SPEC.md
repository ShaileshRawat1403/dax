# DAX TUI Refactor Spec

## 1. Purpose

Refactor the current DAX session screen into the canonical DAX workstation without replacing the current Solid/OpenTUI stack.

This spec is the implementation bridge between:

- the DAX execution model
- the workstation UI blueprint
- the current session-centric TUI route

The goal is a semantic and structural refactor, not a framework restart.

## 2. Scope

This refactor includes:

- semantic rename map for operator-facing pane language
- workstation shell structure for the session route
- pane responsibilities and hierarchy
- lifecycle, focus, and overlay state model
- keyboard and navigation model
- migration order for the current session route

This refactor excludes:

- framework rewrite
- Ratatui migration
- new runtime behavior
- changes to canonical CLI grammar
- new planning, artifact, or audit engines

## 3. Design Goals

The refactor must preserve these goals:

- session-centered workstation
- transcript-centered activity view
- approvals, artifacts, and audit always visible
- alerts only for real intervention
- operator-facing language only
- no leakage of legacy pane vocabulary into primary UX

## 4. Semantic Rename Map

The current pane taxonomy is still shaped by legacy/internal terms.

Current internal surfaces:

- `artifact`
- `diff`
- `rao`
- `pm`
- `audit`

Canonical operator-facing workstation surfaces:

- `Plan`
- `Activity`
- `Approvals`
- `Artifacts`
- `Audit`
- `Alerts`

### Mapping Rules

#### `pm` -> `Plan`

`pm` should no longer leak into user-facing pane language.

Operator meaning:

- plan context
- intended work
- workflow steps

#### `rao` -> absorb into `Activity`, `Approvals`, and `Audit`

`rao` is useful as an internal model, not as operator-facing vocabulary.

Operator meaning splits across:

- `Activity` for progression
- `Approvals` for human checkpoints
- `Audit` for trust posture

#### `artifact` -> `Artifacts`

The generic “context” framing is too broad.

Operator-facing meaning should be:

- retained execution outputs
- inspectable work products

#### `audit` -> `Audit`

The current “docs” slant is too narrow for the new trust model.

Operator-facing meaning should be:

- trust posture
- approvals / overrides summary
- evidence presence
- findings posture

#### `diff`

`diff` should not remain a top-level operator pane by default unless proven necessary.

For this refactor:

- diff evidence is detail-level support
- diff can remain accessible inside artifacts or audit drill-down
- diff may survive internally without remaining a first-class top-level workstation concept

## 5. Workstation Component Structure

The session route should be reorganized around this component tree.

### Top Shell

- `WorkstationShell`
  - `SessionHeader`
  - `WorkstationBody`
  - `SessionFooter`
  - overlay layer

### Body Layout

- `WorkstationBody`
  - `PlanPane`
  - `ActivityPane`
  - `RightSidebar`

### Right Sidebar

- `RightSidebar`
  - `ApprovalsPanel`
  - `ArtifactsPanel`
  - `AuditPanel`

### Overlay Layer

- `ApprovalDialog`
- `AlertDialog`
- `ArtifactDetailOverlay`
- `AuditDetailOverlay`
- `AuditEventsOverlay`

This is a refactor of the current session route structure, not a new application.

## 6. Pane Responsibilities

Each pane must have one primary job.

### `SessionHeader`

- operator question:
  - where am I and what state is this session in?
- DITA role:
  - concept + troubleshooting
- data dependencies:
  - session metadata
  - current phase
  - active step
  - approval state
  - trust posture
- interaction level:
  - low
- primary when:
  - always visible

### `PlanPane`

- operator question:
  - what work is defined?
- DITA role:
  - concept
- data dependencies:
  - session plan summary
  - current step
  - readiness state
- interaction level:
  - medium
- primary when:
  - planning
  - ready
  - execution start

### `ActivityPane`

- operator question:
  - what is happening now?
- DITA role:
  - task
- data dependencies:
  - transcript
  - stream/orchestration stage
  - execution narrative
- interaction level:
  - high
- primary when:
  - always the center pane

### `ApprovalsPanel`

- operator question:
  - what needs my decision?
- DITA role:
  - reference
- data dependencies:
  - pending approvals
  - permission metadata
  - related session/step
- interaction level:
  - medium to high
- primary when:
  - approvals exist

### `ArtifactsPanel`

- operator question:
  - what outputs exist?
- DITA role:
  - reference
- data dependencies:
  - retained outputs
  - session linkage
  - reference paths
- interaction level:
  - medium
- primary when:
  - outputs exist

### `AuditPanel`

- operator question:
  - can I trust this run?
- DITA role:
  - reference
- data dependencies:
  - audit posture
  - findings summary
  - approvals/overrides counts
  - evidence presence
- interaction level:
  - medium
- primary when:
  - trust posture is relevant

### `SessionFooter`

- operator question:
  - what can I do now?
- DITA role:
  - task
- data dependencies:
  - current focus
  - lifecycle state
  - quick action availability
  - attention summary
- interaction level:
  - high
- primary when:
  - always visible

## 7. State Machine

The TUI state model should be explicit and layered.

### A. Lifecycle State

- `planning`
- `ready`
- `executing`
- `awaiting_approval`
- `blocked`
- `completed`
- `failed`

#### Lifecycle Transition Guide

- `planning` -> `ready`
  - when a usable plan exists
- `ready` -> `executing`
  - when execution starts
- `executing` -> `awaiting_approval`
  - when a checkpoint requires operator input
- `awaiting_approval` -> `executing`
  - when approved
- `awaiting_approval` -> `blocked`
  - when denied or policy-blocked
- `executing` -> `completed`
  - when work finishes successfully
- `executing` -> `failed`
  - when execution errors out
- `blocked` -> `ready` or `executing`
  - when operator recovery or rerun path is available

### B. Focus State

- `plan`
- `activity`
- `approvals`
- `artifacts`
- `audit`
- `footer`
- `dialog`

Focus state controls keyboard routing and visual emphasis.

### C. Overlay State

- `none`
- `approval_dialog`
- `artifact_detail`
- `audit_detail`
- `audit_events`
- `alert`

Only one overlay should be primary at a time.

## 8. Keyboard and Navigation Model

The TUI should stay keyboard-first and predictable.

### Global Keys

- `tab`
  - move focus to next pane
- `shift+tab`
  - move focus to previous pane
- `esc`
  - close overlay or return focus to last non-dialog pane
- `q`
  - leave nested detail or back out of current overlay

### Selection and Scrolling

- `j` / `k`
  - move within current list or scrollable pane
- `up` / `down`
  - equivalent directional navigation
- `g`
  - jump to top
- `G`
  - jump to bottom
- `enter`
  - open selected item or drill into current panel detail

### Approval Actions

- `a`
  - approve
- `d`
  - deny

These should only act when focus is in approvals or approval dialog context.

### Audit Actions

- `o`
  - open audit detail
- `e`
  - open audit events

### Artifact Actions

- `enter`
  - open selected artifact

The footer should reflect the active key hints based on focus state.

## 9. Session Route Migration Plan

The session route refactor should happen in controlled passes.

### Pass 1: semantic rename and visible label cleanup

Goals:

- remove legacy pane vocabulary from primary UX
- normalize operator-facing labels
- align header/footer wording with lifecycle states

Targets:

- pane labels
- pane titles
- shell labels
- quick action wording

### Pass 2: shell and body restructure

Goals:

- reshape the session route into:
  - header
  - plan
  - activity
  - sidebar
  - footer

Targets:

- `session/index.tsx`
- header/body/footer composition
- sidebar grouping

### Pass 3: focus model and pane cycling

Goals:

- implement predictable focus transitions
- establish a keyboard-first pane model

Targets:

- focus state
- tab cycle
- selection routing
- footer action hints

### Pass 4: overlay normalization

Goals:

- make approvals, alerts, artifact detail, audit detail, and audit events feel intentional and consistent

Targets:

- approval flow
- alert rendering
- drill-down overlays

### Pass 5: detail cleanup and evidence routing

Goals:

- position diff as detail/evidence rather than legacy top-level confusion
- make artifacts and audit drill-down paths coherent

Targets:

- detail views
- artifact preview
- audit detail and raw events access

## 10. What Must Not Regress

This refactor must not break:

- sync-backed session continuity
- working approval flow
- audit visibility
- session data integration
- current working overlays unless intentionally replaced
- existing route and context plumbing without clear substitute

This section is the guardrail against “cleanup” that removes working product value.

## 11. Acceptance Signals

The refactor is successful when:

- the session screen reads as one workstation
- operator grammar is consistent
- transcript is central
- approvals, artifacts, and audit are visible without mode confusion
- legacy pane naming no longer leaks into user-facing UX
- keyboard navigation is predictable
- overlays feel intentional rather than incidental

## 12. Implementation Notes

This spec assumes:

- current Solid/OpenTUI stack remains
- current session route remains the refactor target
- runtime facts continue to come from existing sync/session/governance/artifact/audit substrate

The point is to improve semantics, layout, and operator flow without destabilizing the working TUI foundation.
