---
title: TUI UX Refresh
archetype: feature
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - feature
  - tui
last_reviewed: 2026-08-19
---

# TUI UX Refresh: Stream Presentation

> **Status note**: This refresh landed in the session route of the TUI
> (packages/dax/src/cli/cmd/tui/routes/session/index.tsx:2526-2554, 2634-2645,
> 2651-2679). The `RunEventRow` chrome changes were rejected
> (packages/dax/src/cli/cmd/tui/component/stream/run-event-row.tsx:88-89), so
> that part of the implementation plan below is historical. The remaining mockups
> reflect the shipped look.

This document outlines the proposed UX improvements for the DAX TUI stream, bringing its visual language closer to the clean, minimal, and highly legible style of the Gemini CLI.

## Core Principles
1. **Minimal Component Borders:** Remove heavy structural borders in favor of spacing, typography, and subtle left-hand accents.
2. **Color Highlights:** Use semantic colors (cyan for shell/container runs, green for success, yellow for approvals, purple for analysis) sparsely to draw attention without overwhelming the user.
3. **Container-like Shell Executions:** Shell commands and tool runs should feel contained, with a subtle background or left border that visually groups the command, its execution state, and its output tail.

## Mockups: As-Is vs To-Be

### 1. Tool Execution (Shell / Background Task)

**As-Is (Current DAX):**
```text
⏺ Running git status...
```
*(Currently just a text row with a dot or a spinner).*

**To-Be (Gemini-Inspired UX):**
```text
  [exec] git status && git diff HEAD
  │ On branch main
  │ Your branch is up to date with 'origin/main'.
  │ nothing to commit, working tree clean
  ╰─ ✓ 12ms
```
*Changes: Added an explicit `[exec]` tag (in semantic color), a subtle vertical connecting line (`│`) indicating the containerized scope of the output, and a clean closing bracket (`╰─`) with timing.*

### 2. Phase Markers & Separators

**As-Is (Current DAX):**
```text
──── ⟳ context compacted ────
```

**To-Be (Gemini-Inspired UX):**
```text
  ⟳  context compacted
```
*Changes: Removed the horizontal rule lines which clutter the terminal. Used spacing and dim text attributes to convey the separation.*

### 3. Agent Messages & Intent

**As-Is (Current DAX):**
```text
[build message - use existing Message component]
I have reviewed the files and will now make the changes.
```

**To-Be (Gemini-Inspired UX):**
```text
  ◇  build
  I have reviewed the files and will now make the changes.
```
*Changes: Replaced bracketed text with a clean diamond icon (colored by agent type) and the agent name in bold. The message follows cleanly below with proper indentation.*

### 4. Inline Alerts & Approvals

**As-Is (Current DAX):**
```text
APPROVAL REQUIRED
Requires operator approval: modify sensitive path
```

**To-Be (Gemini-Inspired UX):**
```text
  ⚠  Approval Required
  │  Modify sensitive path: .github/workflows/ci.yml
  ╰─ [ Approve ]  [ Deny ]
```
*Changes: Uses a vertical line to group the context of the approval, making it feel like an actionable block rather than floating text.*

## Implementation Plan
1. **Update `RunEventRow` (`packages/dax/src/cli/cmd/tui/component/stream/run-event-row.tsx`)**: Introduce a left-border structure for running/completed tools to create the "container run" aesthetic.
2. **Update `TurnSeparator` and `CompactionMarker` (`packages/dax/src/cli/cmd/tui/component/stream/stream-item.tsx`)**: Remove horizontal lines (`border={["top"]}`) and rely on `marginTop`/`marginBottom` with dimmed text.
3. **Enhance Output Tailing**: When a shell command is running, display a live-tail of its output next to the vertical line, colored with `theme.textMuted`.
