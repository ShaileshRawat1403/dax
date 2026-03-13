# DAX TUI Detail Polish

## Purpose

Refine readability, density, and calmness of the DAX workstation without changing interaction ownership, navigation behavior, or runtime logic.

This pass improves how the workstation reads under real session load. It is not a new interaction phase.

## Scope

This pass includes only:

- spacing and density tuning
- empty states for `Plan`, `Activity`, `Approvals`, `Artifacts`, and `Audit`
- session continuity cues
- trust posture emphasis
- artifact metadata readability
- summary-card wording consistency
- truncation and summary rules
- compact header and footer refinement

## Non-Goals

This pass does not include:

- focus ownership changes
- overlay ownership changes
- prompt or dialog priority changes
- workflow or business logic changes
- new commands
- new panes
- new runtime state
- new interaction models

## Design Principles

- `Activity` remains visually dominant.
- The sidebar stays glanceable and compact.
- Summaries explain just enough to orient the operator.
- Trust posture should be visible, not loud.
- Empty states should feel intentional, not blank.
- Wording should stay short, operational, and consistent.
- Polish should reduce noise, not add information volume.

## Pane-By-Pane Targets

### Plan

Goals:

- keep the session goal concise
- keep the step list compact
- make the current step easy to spot
- show an intentional empty state when no plan is available yet

Preferred empty state:

- `No plan available yet. DAX will show the proposed workflow once planning begins.`

### Activity

Goals:

- keep the execution story narrated in workflow terms
- remove noisy repetition where possible
- preserve visual dominance over surrounding panes
- provide a deliberate empty state for not-started sessions

Preferred empty state:

- `No activity recorded yet. DAX will narrate the workflow here once execution starts.`

### Approvals

Goals:

- show pending count clearly
- surface the top approval reason compactly
- keep wording short and operational
- provide a deliberate empty state

Preferred empty state:

- `No approvals pending. DAX will stop here only when operator input is required.`

### Artifacts

Goals:

- show retained output count first
- improve label and kind readability
- surface only the top few items
- provide a deliberate empty state

Preferred empty state:

- `No retained outputs yet. Artifacts will appear here as the session produces reviewable work.`

### Audit

Goals:

- put trust posture first
- keep counts secondary
- make evidence presence easy to read
- provide a deliberate empty state for low-signal sessions

Preferred empty state:

- `No audit issues detected yet. Trust posture will update as DAX records approvals, outputs, and findings.`

## Session Continuity Cues

The workstation should help the operator feel that the session is one continuous lifecycle.

Polish should reinforce:

- visible current step
- latest meaningful action
- retained outputs tied to the same session
- trust posture tied to the latest known execution state

The goal is not more summary text. The goal is stronger continuity with fewer words.

## Truncation And Summary Rules

Use compact summaries by default.

- Sidebar artifact list: show at most `3` visible items before summarizing the remainder.
- Sidebar approvals summary: show at most `1` primary reason line.
- Activity summary: favor recent meaningful lines over long historical dumps.
- Header labels: prefer a single-line operational summary over stacked explanation.
- Long labels should be shortened with an ellipsis only after preserving the leading identity of the item.
- Kind or metadata labels should stay short enough to scan in one glance.

Use ellipsis when:

- the operator can still identify the item unambiguously
- the full value is available in a detail surface

Do not use truncation to hide critical posture or state.

## Acceptance Signals

Pass 5 is successful when:

- the screen stays readable under both low and high activity
- empty states feel deliberate instead of unfinished
- the sidebar is scannable in seconds
- trust posture is easy to notice without dominating the screen
- the header stays compact and operational
- no interaction behavior changes

## Best Implementation Order

1. Empty states and wording consistency
2. Sidebar summary density and truncation
3. Artifact metadata readability
4. Trust posture emphasis
5. Header and footer compactness
6. Final spacing pass across panes and overlays

## Core Rule

Do not let polish increase information volume.

Good polish here means:

- fewer words
- better grouping
- clearer emphasis
- better empty states

It does not mean adding more content to every surface.
