# DAX Terminal Constraints

This document defines how the balanced DAX workstation degrades gracefully across terminal sizes.

It builds on the already locked workstation layers:

- header
- context band
- center stream
- truth sidebar
- evidence overlays
- interaction model

The purpose of this document is to prevent the TUI implementation from inventing collapse behavior ad hoc.

## Terminal Design Principle

The workstation should adapt by reducing density in this order:

1. compress sidebar presentation
2. collapse sidebar into a temporary overlay
3. preserve stream continuity
4. preserve overlay readability

It should not adapt by:

- dropping the stream
- hiding the footer entirely
- turning the sidebar into a scrolling pane
- dumping multiple surfaces into one crowded region

## Width Tiers

## 1. Preferred Width

Preferred width:

```text
120 columns or wider
```

At this width, DAX should present the full balanced workstation:

- full header
- full context band
- full stream
- full right sidebar
- full footer labels

Layout:

```text
HEADER
CONTEXT
STREAM | SIDEBAR
FOOTER
```

## 2. Minimum Supported Width

Minimum supported width:

```text
100 columns
```

At this width, DAX should still preserve the workstation model, but the sidebar becomes compact.

Layout:

```text
HEADER
CONTEXT
STREAM | COMPACT SIDEBAR
FOOTER
```

## 3. Narrow Width

For widths narrower than `100` columns, the workstation should preserve the stream and collapse the sidebar.

Layout:

```text
HEADER
CONTEXT
STREAM
FOOTER
```

At this tier:

- sidebar is hidden by default
- sidebar is available as a temporary overlay or drawer
- the stream becomes full-width

## Sidebar Collapse Rules

## Width >= 120

Show the full sidebar with normal card layout:

- card label
- value
- warning/critical emphasis when needed

Example:

```text
Lifecycle
Active

Trust
Review needed
```

## Width 100-119

Show a compact sidebar:

- each card becomes one line where possible
- labels may be shortened
- no multi-line explanatory text

Example:

```text
Lifecycle: active
Stage: verification
Trust: review
Release: review
Approvals: 1
Artifacts: 3
Writes: governed
```

Compact sidebar rules:

- preserve card order
- preserve warning states
- preserve clickability / overlay entry points
- reduce wording, not meaning

## Width < 100

Collapse the sidebar entirely from the default layout.

Access rule:

```text
[s] sidebar
```

When opened, the sidebar appears as a temporary overlay or side drawer.

Rules:

- sidebar collapse must not remove access to truth
- collapsed sidebar must not permanently displace the stream
- collapsed sidebar should close back to the prior stream focus

## Overlay Sizing Rules

Overlays should remain readable while preserving background context.

### Width

Overlays should:

- center on screen
- occupy at most `80-90%` of terminal width
- leave visible workstation context behind them

They should not:

- consume the full terminal width unless absolutely forced by narrow terminals
- feel like route replacements

### Height

Overlays should:

- fit within the visible terminal height where possible
- leave at least a small amount of background context visible

### Narrow terminals

When terminal width is narrow:

- overlays may expand proportionally
- but header and footer must remain visible where practical
- overlay content must scroll rather than overflow

## Scroll Rules

## Stream

The stream should:

- auto-scroll by default
- pause auto-scroll when the operator scrolls upward
- resume auto-scroll when the operator returns to the live bottom

The stream should never reset on resize.

## Overlays

Overlays may scroll vertically.

Rules:

- overlay header remains pinned
- overlay footer actions remain pinned where practical
- only the evidence body scrolls

## Sidebar

The sidebar should never become a scrolling pane in the default workstation.

If the sidebar would overflow:

- compress first
- collapse second

Do not add sidebar scrolling as the first fallback.

## Footer Constraints

The footer must remain visible across all width tiers.

## Full-width footer

At wider widths:

```text
[t] timeline  [a] artifacts  [v] verify  [r] release  [i] inspect  [p] approvals
```

## Compact footer

At narrower widths:

```text
[t] [a] [v] [r] [i] [p]
```

Footer rules:

- action visibility is preserved even when labels shrink
- footer never becomes multi-line unless terminal height leaves no better option
- footer reflects overlay state when overlays are open

## Resize Behavior

On terminal resize:

- stream reflows
- sidebar expands, compacts, or collapses based on width tier
- overlays resize dynamically
- footer compacts if needed

Resize must not:

- reset focus
- close overlays unnecessarily
- reset stream history
- discard operator scroll position without cause

## Height Constraints

This spec is width-first, but height still matters.

When terminal height is limited:

- context band may compress
- overlay bodies may scroll sooner
- footer remains visible
- stream remains primary

Avoid consuming vertical space with decorative framing.

## Wide / Medium / Narrow Reference Layouts

## Wide

```text
HEADER
CONTEXT
STREAM | SIDEBAR
FOOTER
```

## Medium

```text
HEADER
CONTEXT
STREAM | COMPACT SIDEBAR
FOOTER
```

## Narrow

```text
HEADER
CONTEXT
STREAM
FOOTER
```

Sidebar becomes a temporary overlay.

## Non-Goals

This document does not define:

- exact component implementation
- event loop mechanics
- overlay internal content
- approval policy semantics

## Success Signal

This spec is successful when:

- the workstation remains recognizable across widths
- stream continuity survives resize and collapse
- sidebar truth remains available even when hidden by default
- overlays remain readable without taking over the whole terminal
- implementation does not need to guess collapse behavior
