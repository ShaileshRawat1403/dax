# DAX Stream Spine And Stage Dividers

## Purpose

Define the rendering rules for the execution spine and stage dividers in the DAX workstation stream.

The goal is to make the center panel read as an execution timeline, not a transcript or log dump.

This spec preserves the workstation invariant:

- `Center = narrative`
- `Sidebar = truth`
- `Dialogs/overlays = evidence`

## Core Principles

### 1. Event rows are the primary units

Execution events are the primary items in the stream.

Examples:

```text
├─ Repository structure collected
├─ Runtime entry points identified
└─ Execution completed
```

Events must always carry the visual prefix:

```text
├─
└─
```

Optional continuation line:

```text
│
```

### 2. Stage dividers are structural separators

Stage dividers mark phase transitions in the run lifecycle.

They are not events and must not visually resemble event rows.

Correct:

```text
│──────── Planning ────────
```

Incorrect:

```text
├─ Stage: Planning
```

### 3. Stage dividers appear only on transitions

Dividers are rendered only when:

```text
previousStage != currentStage
```

Never render them for every stage in the model.

Lifecycle example:

```text
Understanding → Planning → Executing → Verifying → Complete
```

Only visible transitions appear in the stream.

### 4. Stage dividers must be visually quieter than steps

Stage markers must not compete with event rows.

Use a subtle line separator.

Recommended style:

```text
│──────── Executing ────────
```

Acceptable alternatives:

```text
──────── Executing ────────
┄┄┄ Executing ┄┄┄
```

Avoid bold symbols, emojis, or step prefixes.

### 5. Do not render a divider before the first event

The first narrative line acts as the implicit stage opener.

Bad:

```text
│──────── Understanding ────────
├─ Repository structure collected
```

Correct:

```text
│ Understanding your request

├─ Repository structure collected
```

## Execution Spine

### Purpose

Provide a visual structure that shows the progression of the run.

The spine uses:

```text
│  vertical continuity
├─ intermediate steps
└─ final step
```

Example:

```text
│ Understanding your request
│
├─ Repository structure collected
│
├─ Runtime entry points identified
│
└─ Execution completed
```

## Combined Example

Correct rendering with spine and stage dividers:

```text
│ Understanding your request
│
├─ Repository structure collected
│  Open detail
│
├─ Root docs surface collected
│  Open detail
│
│──────── Planning ────────
│
├─ Execution plan prepared
│
│──────── Executing ────────
│
├─ Running dependency scan
│
│──────── Verifying ────────
│
└─ Trust signals evaluated
```

## Detail Hints

Detail hints may appear as a secondary line under events.

Example:

```text
├─ Repository structure collected
│  Open detail
```

Detail hints must never appear on stage divider rows.

## Completion Row

The final step in a run should render as:

```text
└─ Execution completed
```

Optional status indicators:

```text
✔ success
⚠ paused
✖ failed
```

Only when necessary.

## Non-Goals

This spec explicitly avoids:

- timestamps on every event
- inline tool output
- long summaries in the stream
- chat-style responses

Those belong in dialogs or overlays.

## Interaction Model

Stream events may open evidence surfaces.

Example:

```text
├─ Repository structure collected
│  Open detail
```

Interaction:

```text
Enter → open response detail dialog
Esc → return to stream focus
```

## Expected Outcome

After implementing this spec, the DAX stream should read like:

- a structured execution pipeline
- a calm operator console
- not a chat transcript
