# DAX TUI Focus Model

## Purpose

Define the Pass 3 focus and keyboard contract for the DAX workstation TUI without rewriting the existing prompt, dialog, or overlay interaction substrate.

This document treats workstation pane focus as a thin layer over the current session-centric TUI, not as a replacement for existing interaction ownership.

## Baseline Reality

The current TUI already has a working interaction hierarchy:

1. dialogs own interaction when open
2. the prompt is the fallback interaction home
3. pane mode exists, but pane focus does not yet exist as a first-class workstation concept

Existing local selection behavior in approval, question, permission, and diff flows is already correct enough and must not be broken by Pass 3.

## Core Rule

Workstation pane focus must not override dialog-local or prompt-local interaction ownership.

This is the main protection for the refactor.

## Interaction Priority

Pass 3 should use this interaction priority order:

1. `dialog`
2. `prompt`
3. `workstation pane`

Meaning:

- if a dialog is open, the dialog owns navigation and confirmation keys
- if the prompt is in an active local mode, its existing behavior remains in control
- workstation pane focus only applies when no higher-priority interaction owner is active

## Default Focus

On session load:

- visible workstation default focus: `activity`
- interaction fallback home: prompt

This distinction is intentional. DAX should look execution-first while still respecting the current prompt-first substrate underneath.

## Focusable Workstation Panes

Pass 3 should introduce only these top-level focus targets:

- `activity`
- `plan`
- `approvals`
- `artifacts`
- `audit`

The footer should remain informational in this slice. It does not need to become its own focus target yet.

## Focus Order

Recommended pane cycle order:

1. `activity`
2. `plan`
3. `approvals`
4. `artifacts`
5. `audit`

This keeps the execution story primary, then context, then oversight.

## Navigation Keys

### Workstation Layer

- `tab` -> next workstation pane
- `shift+tab` -> previous workstation pane

### Guardrails

- if a dialog is open, `tab` and `shift+tab` keep their existing dialog/local meaning
- if the question flow is active, its current `tab` behavior remains untouched
- if prompt-local behavior already owns the key, workstation focus must not steal it

Workstation pane cycling only applies when no higher-priority interactive mode is active.

## Enter Behavior

Pass 3 should not force one universal `enter` action.

It should define pane-aware primary actions only where they already map naturally:

- `activity` -> no new primary action in Pass 3
- `plan` -> no-op in Pass 3
- `approvals` -> open approval detail / live review
- `artifacts` -> open artifact/detail surface
- `audit` -> open audit detail

Existing dialog-owned and prompt-owned `enter` behavior remains unchanged.

## Escape Behavior

Pass 3 must preserve current `esc` meaning.

`esc` should continue to:

- close or cancel dialog-owned interactions
- interrupt or abort session behavior where already supported
- exit shell-input mode
- return from overlays according to current logic

It must not be repurposed as generic pane unfocus.

## Q Behavior

Do not introduce standalone `q` in Pass 3.

Keep current leader-based exit behavior intact to avoid conflicting with established session behavior.

## Focus Visibility

Focused pane state should be obvious but lightweight.

Allowed treatment:

- title emphasis
- border emphasis
- subtle background or label change

Avoid heavy visual noise or dashboard-style decoration.

The operator should be able to tell the focused pane immediately without losing the centrality of the activity transcript.

## Footer Behavior

The footer should become pane-aware, not focusable.

Pass 3 footer contract:

- global keys remain visible consistently
- pane-specific hints change based on the focused pane
- if a dialog is open, footer hints should defer to dialog actions

This is one of the highest-value parts of Pass 3 because it makes the workstation feel intentional without changing deeper mechanics.

## Out of Scope for Pass 3

Pass 3 should not include:

- overlay redesign
- approval flow redesign
- artifact detail redesign
- audit detail redesign
- nested focus stacks
- `hjkl` pane navigation
- footer as a first-class focus target
- deeper selection-model rewrites in existing dialog/prompt flows

## Recommended Implementation Scope

### Include now

- pane focus state
- visual focus treatment
- `tab` / `shift+tab` pane cycling
- pane-aware footer hints
- `enter` for `approvals`, `artifacts`, and `audit`

### Delay slightly

- richer `enter` behavior for `activity`
- pane-level `hjkl` navigation
- nested selection models across workstation panes
- any dialog or overlay ownership rewrite

## Acceptance Signals

Pass 3 is successful when:

1. `activity` is the default visible workstation focus.
2. `tab` and `shift+tab` cycle workstation panes only when no higher-priority interaction owner is active.
3. Focused pane state is visually obvious.
4. Footer help changes with the focused pane.
5. `enter` opens the expected detail for `approvals`, `artifacts`, and `audit`.
6. Existing prompt, approval, question, permission, and diff interactions continue to work unchanged.

## Summary Rule

Add workstation pane focus as a thin, visible layer over the current prompt-first and dialog-priority interaction model, without fighting existing local behaviors.
