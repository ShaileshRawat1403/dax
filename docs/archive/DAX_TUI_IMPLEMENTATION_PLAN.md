# DAX TUI Implementation Plan

This document is the final bridge from the workstation design phase into TUI implementation.

It translates the now-stable DAX workstation design into concrete implementation responsibilities.

It builds on the already locked design stack:

- workstation refined mockup
- sidebar spec
- stream spec
- overlay spec
- overlay layouts
- approval interruption spec
- interaction spec
- terminal constraints

## Implementation Goal

Implement the balanced DAX workstation without allowing the codebase to re-invent:

- layout rules
- surface roles
- overlay semantics
- focus rules
- collapse behavior

The implementation should preserve the core invariant:

- center = narrative
- sidebar = truth
- overlays = evidence

## Workstation Regions

The workstation should be implemented as five layout regions:

1. `Header`
2. `ContextBand`
3. `MainBody`
4. `Footer`
5. `OverlayLayer`

## Region Responsibilities

### 1. Header

Purpose:

- lightweight session identity and global state

Should contain:

- product label
- session title or identifier
- compact lifecycle / trust / release state when appropriate

Should not contain:

- long context text
- detailed explanations
- sidebar card content

### 2. ContextBand

Purpose:

- hold task / session context above the stream

Should contain:

- concise task description
- prompt or plan context summary when useful

Should not become:

- a planning pane
- a reasoning dump

### 3. MainBody

Purpose:

- split workstation into stream and sidebar

Wide and medium widths:

- left = `StreamPane`
- right = `SidebarPane`

Narrow widths:

- `StreamPane` only
- sidebar available through temporary overlay/drawer

### 4. Footer

Purpose:

- expose shortcut hints and close behavior

Should contain:

- overlay shortcuts
- optional focus hint
- compact action labels at narrow widths

Should remain visible across size tiers.

### 5. OverlayLayer

Purpose:

- render evidence and approval overlays above the workstation

Includes:

- verify overlay
- release overlay
- artifacts overlay
- timeline overlay
- inspect overlay
- approvals overlay

## Component Boundaries

Implementation should favor explicit components aligned to workstation roles.

## Recommended Component Set

### Shell and Regions

- `WorkstationShell`
- `WorkstationHeader`
- `WorkstationContextBand`
- `WorkstationBody`
- `WorkstationFooter`

### Main Body

- `StreamPane`
- `SidebarPane`
- `SidebarCard`

### Overlays

- `VerifyOverlay`
- `ReleaseOverlay`
- `ArtifactsOverlay`
- `TimelineOverlay`
- `InspectOverlay`
- `ApprovalsOverlay`
- `SidebarDrawer` for collapsed sidebar at narrow widths

### Supporting Presentation

- `WorkstationViewModel`
- `OverlayViewModel` per overlay family where needed
- `TerminalLayoutState`

## View-Model Boundaries

Keep derivation shallow and presentation-oriented.

Recommended derived state buckets:

- header summary
- context summary
- stream items
- sidebar summaries
- active overlay content
- terminal width tier

Do not move business logic into the workstation view-model.

Runtime truth should continue to come from canonical session, trust, release, artifact, timeline, and governance surfaces.

## Sidebar Collapse Behavior

Implementation should follow the already-locked width tiers.

### Width >= 120

- full sidebar

### Width 100-119

- compact sidebar

### Width < 100

- sidebar hidden by default
- openable via `[s]`
- shown as temporary drawer or overlay

Implementation rule:

- collapse behavior belongs in layout state, not in sidebar business logic

## Overlay Routing

The workstation should use one active overlay at a time in the first version.

## Suggested Overlay Route Enum

```text
none
verify
release
artifacts
timeline
inspect
approvals
sidebar_drawer
```

Rules:

- only one overlay active at once
- opening a new overlay replaces the current one
- closing returns to prior workstation focus

## Overlay Entry Points

- `Trust` card -> `verify`
- `Release` card -> `release`
- `Artifacts` card -> `artifacts`
- `Write governance` card -> `inspect` or `verify`
- `[t]` -> `timeline`
- `[i]` -> `inspect`
- `[p]` -> `approvals`
- `[s]` -> collapsed sidebar drawer when narrow

## Focus Ownership

Follow the locked interaction hierarchy.

## Focus Priority

1. active overlay
2. prompt / active input
3. workstation pane focus

### Workstation pane focus set

- `stream`
- `sidebar`
- `footer`

Rules:

- overlays outrank pane focus
- pane focus should never distort the meaning of stream/sidebar roles
- focus restoration after overlay close is mandatory

## Resize Handling

Resize logic should be centralized.

## Resize responsibilities

- determine width tier
- switch sidebar mode: full / compact / collapsed
- recompute body layout
- resize overlays
- compact footer labels when needed

Resize must not:

- reset stream history
- drop current overlay unnecessarily
- lose prior focus state

## Event Loop Responsibilities

The event loop should remain thin and explicit.

## Event categories

### 1. Navigation events

- focus change
- open overlay
- close overlay
- sidebar drawer toggle

### 2. Resize events

- recompute layout tier
- recompute overlay bounds

### 3. Stream/session update events

- append stream items
- refresh sidebar summaries
- refresh overlay data if open

### 4. Approval interruption events

- append interruption event to stream
- set lifecycle paused state in summaries
- update approvals card
- allow approvals overlay open via shortcut

### 5. Overlay interaction events

- scroll overlay body
- close overlay
- approve / deny where applicable in approvals overlay

## Event Loop Non-Goals

The event loop should not:

- own trust logic
- own release logic
- own artifact indexing
- own policy evaluation

It should orchestrate presentation and interaction only.

## Implementation Order

Recommended implementation order:

1. `WorkstationShell` and layout regions
2. stream + sidebar rendering using current canonical data
3. terminal width-tier handling
4. overlay routing and shared overlay shell
5. implement overlays in this order:
   - timeline
   - artifacts
   - verify
   - release
   - inspect
   - approvals
6. approval interruption presentation
7. footer / shortcut refinement

## Non-Goals

This plan does not include:

- redesign of runtime semantics
- approval policy changes
- new trust/readiness logic
- new history models
- visual polish beyond layout correctness

## Success Signal

This implementation plan is successful when:

- the TUI implementation can proceed without inventing new workstation rules
- component boundaries match design boundaries
- stream, sidebar, and overlays remain semantically separate
- collapse and resize behavior are explicit
- the workstation can be implemented incrementally without architectural churn
