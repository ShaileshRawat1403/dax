# DAX Workstation Screen Layout

This document is the final terminal layout spec for the balanced DAX workstation.

It is not a variant note and not a conceptual overview.

It locks:

- full-screen region order
- region proportions
- header behavior
- task/context band behavior
- center stream placement
- sidebar placement
- footer behavior
- overlay placement
- narrow-terminal layout changes
- one canonical text mockup

This document should be concrete enough to implement from directly.

## Layout Invariant

The workstation continues to follow the hard product rule:

- center = narrative
- sidebar = truth
- overlays = evidence

This document only turns that rule into a concrete screen layout.

## Full-Screen Layout

The full screen has four permanent vertical regions in this exact order:

1. `Header`
2. `Task / Context band`
3. `Main body`
4. `Footer`

Inside the main body there are two horizontal regions:

1. `Center live stream`
2. `Right truth sidebar`

Overlay surfaces sit on top of the full screen and do not replace the underlying layout.

## Region Order

The final vertical order is:

```text
HEADER
TASK / CONTEXT
MAIN BODY
FOOTER
```

The final main-body order is:

```text
LIVE STREAM | TRUTH SIDEBAR
```

## Region Proportions

These proportions are implementation targets, not pixel-perfect rules.

### Header

- height: `2 lines`
- purpose: orientation only

### Task / Context band

- height: `3 lines`
  - title line
  - content line
  - divider line
- purpose: persistent scope framing

### Main body

- uses the remaining available vertical space
- split into:
  - center stream: `70-76%` of width at `120+`
  - sidebar: `24-30%` of width at `120+`

### Footer

- height: `1 line`
- purpose: current interaction hints only

### Overlay sizing

- width: `80-90%` of terminal width at normal widths
- height: `70-85%` of terminal height where practical
- always bounded and centered
- never full-screen by default unless forced by narrow terminals

## Header Contract

The header stays minimal.

It should show only:

- product name
- session title or label
- lightweight global state

Allowed compact global state:

- lifecycle
- trust
- release

The header must not show:

- artifact counts
- approval counts
- write-governance explanation
- verification reasons
- audit detail

Example header:

```text
+--------------------------------------------------------------------------------------------------+
| DAX — Execution Control Plane                                                                    |
| Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Release: Not ready          |
+--------------------------------------------------------------------------------------------------+
```

## Task / Context Band

The task/context band sits directly under the header and above the stream.

It always exists while a session is active.

It should show:

- current task framing
- current scope or objective

It must not show:

- live status updates
- trust or release reasoning
- artifact inventories
- long multi-line explanations

### Content rules

- max visible content: `1 concise sentence`
- truncate after roughly `100-120` visible characters in normal layout
- if no explicit task is available, show a calm placeholder:
  - `No active task context recorded yet`

### Collapse behavior

At narrow widths, the task/context band may compress into:

- title line
- one shortened content line

It should not disappear before the sidebar does.

## Center Stream Region

The center stream is the dominant region of the screen.

It owns:

- narrative execution events
- progress transitions
- interruptions
- short completion signals

It does not own:

- durable truth
- evidence summaries
- release reasoning
- artifact lists

### Stream behavior

- occupies the full available main-body height
- scrollable vertically
- remains the dominant visual surface at all widths
- preserves scroll position on resize
- interruption lines appear inline and visually distinct
- completion lines stay short and terminal

### Event density

The stream should aim for:

- one meaningful line per event
- short multi-line interruption blocks only when needed
- no large explanatory blocks

### Interruption rendering

Interruptions appear inline in the stream as event blocks:

```text
Approval required for project write
-> Press [p] to review approvals
```

### Completion rendering

Completion stays short:

```text
Artifact written: dependency-report.json
Verification finished
Run completed
```

## Sidebar Region

The sidebar is placed on the right side of the main body and remains fixed while the stream scrolls.

It follows the existing sidebar contract in:

- [DAX_WORKSTATION_SIDEBAR_SPEC.md](DAX_WORKSTATION_SIDEBAR_SPEC.md)

Concrete screen placement is now locked as:

- right aligned
- vertically stacked cards
- same top alignment as the stream content area
- no independent scrolling in default full layout

### Sidebar card order

The sidebar order is fixed:

1. `Lifecycle`
2. `Stage`
3. `Trust`
4. `Release`
5. `Approvals`
6. `Artifacts`
7. `Write governance`

### Sidebar width target

At `120+` columns:

- target width: `28-34 columns`

At `100-119` columns:

- compact one-line card rendering

At `<100` columns:

- sidebar collapses out of the default layout

## Footer Region

The footer always remains visible.

It owns:

- overlay shortcuts
- evidence shortcuts
- current close/return hint

It does not own:

- status explanation
- secondary metrics
- multi-line help

### Base footer

Normal width:

```text
[t] timeline   [a] artifacts   [v] verify   [r] release   [i] inspect   [p] approvals
```

Compact width:

```text
[t] [a] [v] [r] [i] [p]
```

Overlay mode:

- footer switches to overlay-specific hints only
- base workstation shortcut list is hidden while overlay focus is active

## Overlay Placement

Overlays are placed above the full workstation.

Placement rules:

- centered horizontally
- vertically bounded
- background workstation remains visible
- only one overlay at a time

### Overlay visual behavior

- underlying header, context band, stream, and sidebar remain dimly visible
- overlay takes interaction focus
- close returns to previous focus target

### Overlay position

Canonical placement:

- centered block
- top margin preserved
- footer of base workstation visually suppressed while overlay footer is active

## Narrow Terminal Behavior

The layout supports three width states.

### 1. `120+`

Full balanced layout:

```text
HEADER
TASK / CONTEXT
STREAM | SIDEBAR
FOOTER
```

Behavior:

- full sidebar
- full footer labels
- normal overlay size

### 2. `100-119`

Compact balanced layout:

```text
HEADER
TASK / CONTEXT
STREAM | COMPACT SIDEBAR
FOOTER
```

Behavior:

- sidebar cards collapse to one-line values where possible
- footer labels shorten
- task/context band shortens but remains visible

### 3. `<100`

Collapsed workstation layout:

```text
HEADER
TASK / CONTEXT
STREAM
FOOTER
```

Behavior:

- sidebar hidden from the default layout
- sidebar available as a temporary overlay or drawer
- stream becomes full width
- footer uses compact shortcut form
- overlays may expand toward the full width, but remain bounded where possible

## Canonical Screen Mockup

This is the final implementation north star for the balanced workstation at normal width.

```text
+--------------------------------------------------------------------------------------------------+
| DAX — Execution Control Plane                                                                    |
| Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Release: Not ready          |
+--------------------------------------------------------------------------------------------------+

TASK / CONTEXT
----------------------------------------------------------------------------------------------------
Dependency audit and release assessment for current repository

+--------------------------------------------------------------+-----------------------------------+
| LIVE STREAM                                                  | TRUTH SIDEBAR                     |
| ------------------------------------------------------------ | --------------------------------- |
| Planning workflow                                            | Lifecycle                         |
| Collecting repository signals                                | Active                            |
| Running dependency scan                                      |                                   |
| Producing report artifact                                    | Stage                             |
| Approval required for project write                          | Verification                      |
| -> Press [p] to review approvals                             |                                   |
| Execution paused                                             | Trust                             |
|                                                              | Review needed                     |
|                                                              |                                   |
|                                                              | Release                           |
|                                                              | Review ready                      |
|                                                              |                                   |
|                                                              | Approvals                         |
|                                                              | 1 pending                         |
|                                                              |                                   |
|                                                              | Artifacts                         |
|                                                              | 3 retained                        |
|                                                              |                                   |
|                                                              | Write governance                  |
|                                                              | Governed completed write          |
+--------------------------------------------------------------+-----------------------------------+

[t] timeline   [a] artifacts   [v] verify   [r] release   [i] inspect   [p] approvals
```

## Implementation Use

This document should now be used as the direct comparison target for the current TUI.

The next implementation sequence should be:

1. compare current session screen against this layout
2. refine overlay open/close behavior
3. refine focus and pane ownership
4. implement terminal collapse and degradation behavior
5. polish approval interruption UI
