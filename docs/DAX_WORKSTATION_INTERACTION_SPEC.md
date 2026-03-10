# DAX Workstation Interaction Spec

This document defines the interaction model for the balanced DAX workstation after the center, sidebar, and overlay roles have been established.

It covers:

- focus ownership
- open/close behavior
- shortcut behavior
- interaction priority across stream, sidebar, and overlays

It does not define visual styling or implementation details.

## Purpose

The workstation interaction model should make the product feel:

- predictable
- inspectable
- interruption-safe
- centered on ongoing execution

The operator should always know:

- what surface currently owns interaction
- how to move to another surface
- how to open evidence
- how to return cleanly

## Interaction Invariant

The workstation must preserve this hierarchy:

1. `overlay`
2. `sidebar focus`
3. `stream focus`
4. `prompt / default command entry`

In plain terms:

- overlays take priority when open
- sidebar focus matters only when no overlay is open
- stream remains the primary visual surface
- command input stays available as the base interaction home when nothing else is being inspected

## Focus Ownership

## 1. Base Focus

Default focus should return to the command/prompt entry with the stream visible as the main execution surface.

Why:

- DAX is still an execution workstation, not a keyboard-only dashboard
- operators should not get trapped in passive navigation modes

## 2. Sidebar Focus

Sidebar focus exists only for:

- scanning cards deliberately
- opening overlays from cards

Sidebar focus should not:

- take over by default
- interrupt the live execution story

## 3. Overlay Focus

When an overlay opens:

- it becomes the active focus owner
- keyboard behavior should scope to that overlay
- closing should restore the prior focus location

This is mandatory for:

- `verify`
- `release`
- `artifacts`
- `timeline`
- `inspect`

## Open / Close Rules

## Opening

An overlay can open from:

- sidebar card activation
- explicit keyboard shortcut

Opening an overlay should:

- preserve the underlying workstation state
- not clear stream context
- not reset prompt context

## Closing

Closing an overlay should:

- return to the prior focus target
- preserve sidebar selection if the overlay was opened from a sidebar card
- preserve stream continuity

The operator should feel like they inspected something and came back, not like they navigated to a different page.

## Overlay Replacement

If one overlay opens while another is already active:

- the new overlay may replace the old one in a single-layer model
- or the system may treat this as a drilldown transition

For the first version, prefer a single active overlay model:

- one overlay at a time
- opening a second overlay replaces the current one
- close returns to the workstation, not a nested overlay stack

Why:

- keeps the first interaction model simple
- reduces focus confusion

## Shortcut Model

The workstation should use direct, memorable shortcuts tied to evidence surfaces.

Recommended first mapping:

- `t` -> timeline overlay
- `a` -> artifacts overlay
- `v` -> verify overlay
- `r` -> release overlay
- `i` -> inspect overlay
- `p` -> approvals overlay when pending approvals exist
- `q` / `esc` -> close active overlay or leave focused subview

## Shortcut Rules

### 1. Shortcuts open evidence, not mutate state

The first workstation shortcut layer should be inspect-first.

That means shortcuts should:

- open overlays
- close overlays
- move between surfaces

They should not:

- trigger write actions
- redesign approvals flow
- overload the workstation with command-palette behavior

### 2. `q` and `esc` should be reliable exits

When an overlay is open:

- `esc` closes it
- `q` may also close it in a workstation-specific interaction model

When no overlay is open:

- `q` should not unexpectedly terminate the entire session unless that is already a broader product convention

For the workstation layer, treat `q` as:

- leave current inspect surface
- not global exit by default

### 3. Shortcuts should not compete with the prompt

If the prompt is actively capturing text:

- workstation shortcuts should not steal input unexpectedly

This preserves the command-entry-first nature of DAX.

## Sidebar Card Activation Rules

Cards with overlays behind them should support activation.

Initial mapping:

- `Trust` -> verify
- `Release` -> release
- `Artifacts` -> artifacts
- `Write governance` -> inspect
- `Approvals` -> approvals overlay when pending

Non-activating cards in first version:

- `Lifecycle`
- `Stage`

Why:

- activation should only exist where a meaningful drilldown exists
- fake clickability erodes clarity

## Stream Interaction Rules

The stream is primarily for viewing, not deep navigation.

In the first version:

- the stream should remain visually central
- interruptions may offer direct prompts such as review instructions
- opening deeper evidence should still route through overlays

The stream should not become:

- a scroll-heavy evidence browser
- a focus-trap
- a place where persistent state is edited

## Footer / Hint Behavior

The footer should reflect the current interaction layer.

### Base workstation footer

Show:

- evidence shortcuts
- close / return shortcut

Example:

```text
[t] timeline   [a] artifacts   [v] verify   [r] release   [i] inspect   [q] close
```

### Overlay footer

Show only overlay-relevant hints:

- close
- scroll
- next/previous item if relevant

Do not show the full base footer while deep inside an overlay if it causes clutter.

## Approvals Interaction Note

Approvals remain a special interruption surface.

For the workstation layer:

- approvals can open as an overlay when pending
- interruption events in the stream should point to the approvals surface
- the broader approval workflow itself is out of scope for this spec

## First-Version Simplicity Rules

The first workstation interaction layer should prefer:

- one active overlay at a time
- direct shortcuts
- reliable close behavior
- no nested overlay stacks
- no heavy mode switching

This keeps the system legible while the workstation matures.

## Non-Goals

This document does not:

- redefine the existing prompt system
- redesign the broader TUI keymap
- add command-palette behavior
- define animation or styling

## Success Signal

The interaction model is correct when:

- operators always know which surface owns focus
- overlays feel one action away and easy to exit
- the stream remains central without becoming interactive clutter
- sidebar cards act as clear evidence entry points
- the workstation feels like one coherent environment rather than disconnected panels
