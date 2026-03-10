# DAX Workstation Overlay Spec

This document defines the overlay layer for the balanced DAX workstation.

It builds on the already locked workstation invariants:

- center = narrative
- sidebar = truth
- overlays = evidence

The purpose of overlays is to expose deep evidence and explanation without polluting the live stream or overloading the sidebar.

## Overlay Purpose

Overlays answer questions such as:

- why is trust degraded?
- why is release not ready?
- what artifacts were retained?
- what meaningful steps did the session pass through?
- what is the composed deep state of this session?

They are not meant to:

- replace the stream
- replace the sidebar
- act as dashboards
- expose raw internals by default

## Overlay Set

The balanced workstation should support five primary evidence overlays:

1. `verify`
2. `release`
3. `artifacts`
4. `timeline`
5. `inspect`

Each one has a clear purpose and should not duplicate the others.

## Shared Overlay Rules

### 1. Overlays outrank sidebar focus

When an overlay is open, it becomes the active interaction surface.

Sidebar and stream remain visible as context but do not compete for focus.

### 2. Overlays never replace the live stream

The stream remains the base execution surface underneath.

Overlays sit above it as drilldown views.

### 3. Overlays are inspect-first, not action-first

An overlay primarily exists to explain and inspect.

It may offer navigation or close/open behavior, but it should not become a command-heavy control surface in the first version.

### 4. Close returns to prior focus

Closing an overlay should return the operator to the prior focus state in the workstation.

This preserves continuity and prevents navigation disorientation.

### 5. Overlays explain, not dump raw internals

Overlays should summarize and structure evidence.

They should avoid raw ledger dumps, internal event noise, or unbounded technical output unless a specialized lower-level mode is explicitly introduced later.

## Overlay Definitions

## 1. Verify Overlay

Purpose:

- expose trust judgment
- show pass/fail/incomplete/degraded checks
- explain the main reasons trust is limited

Must show:

- verification result
- trust posture
- check list with concise status per check
- degradation reasons

Should include:

- lifecycle completeness
- approvals status
- write-governance outcome
- evidence completeness
- findings resolution

Should not include:

- raw policy engine traces
- long artifact inventories
- release-readiness reasoning unless directly relevant to trust

Entry points:

- `Trust` sidebar card
- optional keyboard shortcut for verify drilldown

Role:

- trust judgment overlay

## 2. Release Overlay

Purpose:

- expose readiness judgment for handoff or shipping
- show blockers and missing evidence

Must show:

- readiness result
- blockers
- missing evidence
- readiness summary

Should include:

- whether the session is review ready / handoff ready / release ready
- which signals prevent stronger readiness

Should not include:

- detailed artifact browsing
- raw verification check output duplicated in full

Entry points:

- `Release` sidebar card
- release keyboard shortcut

Role:

- readiness judgment overlay

## 3. Artifacts Overlay

Purpose:

- expose retained outputs as a usable grouped inventory

Must show:

- retained artifacts
- artifact kinds
- compact paths or labels

Should include:

- grouping by artifact kind where helpful
- a concise count or summary

Should not include:

- unrelated trust or release reasoning
- long audit explanations

Entry points:

- `Artifacts` sidebar card
- artifacts keyboard shortcut

Role:

- evidence inventory overlay

## 4. Timeline Overlay

Purpose:

- expose meaningful session progression in chronological order

Must show:

- meaningful timeline entries
- chronology only
- state effects where useful

Should include:

- session creation
- execution start
- approvals requested/resolved
- artifacts produced
- execution completed
- meaningful trust or stage transitions when appropriate

Should not include:

- transcript chatter
- raw token streaming
- long reasoning detail

Entry points:

- explicit timeline shortcut
- possibly timeline summary trigger later

Role:

- progression overlay

## 5. Inspect Overlay

Purpose:

- expose the composed deep session view

Must show:

- lifecycle
- stages
- write governance
- summary-level evidence rollup
- timeline/artifact/audit/verification context in one place

Should include:

- write outcome
- governance status
- write risk bucket
- compact explanatory summary

Should not duplicate:

- full artifacts inventory when the artifacts overlay already handles that better
- full release blocker detail when release overlay handles that better

Entry points:

- explicit inspect shortcut
- `Write governance` sidebar card

Role:

- deep composed session explanation overlay

## Entry Point Mapping

The first mapping should be:

- `Trust` -> `verify`
- `Release` -> `release`
- `Artifacts` -> `artifacts`
- `Write governance` -> `inspect`
- timeline via explicit shortcut
- deep session state via `inspect`

Conditional mapping:

- `Approvals` opens approvals overlay when pending

Non-clickable by default:

- `Lifecycle`
- `Stage`

Why:

- only expose clickable affordances when there is a clear evidence surface behind them

## Interaction Model

Overlays should share a consistent interaction model:

- open from sidebar or shortcut
- take focus immediately
- support close/back consistently
- restore prior focus on close

They should not each invent a different navigation pattern in the first version.

## What Overlays Must Not Become

Overlays must not become:

- transcript replacements
- editing workspaces
- approval workflow redesigns
- dashboard metric panels
- raw ledger browsers

If deeper forensic browsing is needed later, it should be a deliberate separate surface.

## Refined Workstation Model

With the overlay layer in place, the workstation model becomes:

- center = execution story
- sidebar = persistent truth
- overlays = explanation and evidence

This gives DAX a clear operator shape:

- the stream tells what happened
- the sidebar tells what is true
- the overlays tell why it matters

## Non-Goals

This document does not:

- define overlay visual styling in detail
- define keyboard bindings exhaustively
- redesign approvals workflow
- reopen stream or sidebar rules

## Success Signal

The overlay layer is correct when:

- operators can reach evidence in one action
- overlays add explanation without overwhelming the base workstation
- each overlay has a clear job
- no overlay duplicates another one badly
- the workstation still feels like an execution environment rather than a monitoring console
