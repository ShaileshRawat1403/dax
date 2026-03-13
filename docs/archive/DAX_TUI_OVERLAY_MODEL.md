# DAX TUI Overlay Model

## Purpose

Normalize overlay behavior and presentation within the DAX workstation without changing the underlying runtime, prompt, dialog, or approval/question logic.

Pass 4 is an overlay normalization pass, not a workflow redesign.

## Why This Exists

Pass 1 through Pass 3 made the workstation itself coherent:

- the shell is session-centered
- activity is the dominant pane
- oversight panes are visible
- pane focus exists
- footer help is pane-aware

The next inconsistency is the overlay layer. Approval, question, permission, diff, and audit-adjacent dialogs still come from older interaction patterns. They now need one coherent workstation-facing contract.

## Core Rule

Opening an overlay should feel like entering a focused subview of the workstation, not leaving the workstation.

## Interaction Priority

Overlay ownership follows the existing TUI interaction priority:

1. `dialog/overlay`
2. `prompt`
3. `workstation pane`

Implications:

- overlays always suspend workstation pane cycling while open
- overlays take precedence over pane-level `enter` behavior
- overlays do not replace prompt/dialog ownership rules that already work

## Canonical Overlay Set

Pass 4 should normalize toward this operator-facing set:

- `approval_dialog`
- `alert_dialog`
- `artifact_detail`
- `audit_detail`
- `audit_events`

Some current flows may still be implemented by older dialog or prompt components, but operator-facingly they should converge on this model.

## Overlay Entry Points

The workstation should open overlays from clear pane-owned actions:

- `approvals` pane -> approval dialog or live approval review
- `artifacts` pane -> artifact detail
- `audit` pane -> audit detail
- `audit detail` -> audit events
- alerts or blocking runtime states -> alert dialog when interruption is warranted

The important rule is consistency:

- panes open overlays
- overlays deepen the current pane context
- closing an overlay returns the operator to the pane that opened it

## Overlay Ownership Rules

### While Open

- pane cycling is suspended
- pane-local primary actions are suspended
- footer becomes overlay-aware
- overlay-local keys and actions take precedence

### On Close

- focus returns to the previously focused workstation pane
- prompt remains the interaction fallback home underneath
- no extra navigation step should be required to recover the prior workstation context

This return behavior is one of the most important parts of Pass 4.

## Exit Behavior

Pass 4 should preserve existing local behavior while normalizing the contract:

- `esc` closes or cancels according to current overlay logic
- confirm actions remain owned by the overlay
- destructive or blocking flows keep their current confirmation behavior

Pass 4 must not repurpose `esc` or rewrite the existing approval/question semantics.

## Footer Behavior

When an overlay is open, the footer should switch from pane-aware hints to overlay-aware hints.

Examples:

- approval dialog: `enter confirm`, `esc close`
- audit detail: `e audit events`, `esc close`
- audit events: `esc close`
- artifact detail: `esc close`
- alert dialog: `enter confirm`, `esc cancel` when applicable

This keeps the footer aligned with the true interaction owner.

## Visual Contract

Overlays do not need a single implementation immediately, but they should follow one visual contract:

- consistent title treatment
- consistent border emphasis
- consistent action row structure
- consistent spacing and density
- consistent wording for close, cancel, confirm, and blocked states

They should look like subviews of the same product, not separate utilities.

## Naming and Language

Operator-facing overlay language should stay consistent with the workstation grammar:

- `Approval required`
- `Pending approvals`
- `Artifact detail`
- `Audit summary`
- `Audit events`
- `Blocked action`
- `Awaiting operator decision`

Avoid leaking older internal terms or mixed review vocabulary into overlay titles and action hints.

## Recommended Implementation Order

### 1. Normalize naming and intent

- align overlay titles and operator wording
- remove legacy or inconsistent labels where surfaced

### 2. Restore prior focused pane on close

- track which workstation pane opened the overlay
- return to that pane when the overlay closes

### 3. Make the footer overlay-aware

- overlay actions replace pane hints while open

### 4. Align visual framing

- approval, audit, and artifact overlays should feel related

### 5. Clean up obvious entry and exit mismatches

- only where the current open/close path feels inconsistent with the workstation model

## Non-Goals

Pass 4 should not include:

- approval workflow redesign
- question flow redesign
- permission system redesign
- diff subsystem redesign
- nested modal stack redesign
- new runtime behavior
- additional focus-model expansion beyond the current workstation contract

## Acceptance Signals

Pass 4 is successful when:

1. Opening an overlay feels like entering a focused subview of the workstation.
2. Closing an overlay returns the operator to the expected pane.
3. Footer actions match the active overlay.
4. Approval, audit, and artifact overlays feel visually related.
5. Existing approval, question, permission, and diff behavior still works.

## Summary Rule

Normalize overlays as part of the workstation interaction system, while preserving the working dialog and prompt substrate underneath.
