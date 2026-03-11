# DAX Session History Surface

## Purpose

Define the first operator-facing history surface for DAX sessions as durable governed work records.

This surface exists to:

- browse recent and older sessions
- revisit completed, failed, blocked, or active sessions
- inspect the durable record of a session without reopening the live workstation
- provide a gateway into timeline, artifacts, audit posture, and verification state

Session history is not a replay engine and not a second workstation.
It is the operator's record-navigation surface for AI-assisted work that has already happened or is still in progress.

## Operator Questions

The history surface should answer:

- What sessions exist?
- Which sessions are recent?
- Which sessions completed, failed, or were blocked?
- Which sessions are verified, degraded, or still review-needed?
- Which sessions produced useful artifacts or outputs?
- How do I reopen the important context of a past session?

## First Surface Decision

### Chosen Direction

Start with a CLI-first session history surface.

This is the safest next step because it:

- reuses the existing session runtime and inspection commands
- keeps the surface inspect-first and low-risk
- validates durable session summaries before adding workstation history browsing
- avoids mixing live execution concerns with historical record navigation

### Why Not TUI First

The workstation already owns current execution context.

Session history is a different operator concern:

- current workstation: `what is happening now?`
- session history: `what sessions exist, and what happened in them?`

That distinction should be proven in CLI before adding another TUI browsing surface.

## Core History Surfaces

The first history layer should define three related surfaces.

### 1. `dax session list`

Purpose:

- browse recent sessions quickly
- identify which session to inspect next

V1 should show compact records such as:

- session id
- title or intent label
- lifecycle outcome
- trust posture
- verification result
- updated time

This is the browsing surface, not the deep-inspection surface.

### 2. `dax session show <session-id>`

Purpose:

- expose a concise durable summary for one session

V1 should show:

- session identity
- title or intent
- lifecycle state or outcome
- trust posture
- verification result
- artifact count
- approvals / overrides summary
- latest activity

This is the summary surface, not the progression surface.

### 3. `dax session inspect <session-id>`

Purpose:

- provide a deeper operator inspection view for a single session record

V1 should expose links or summaries for:

- timeline
- artifacts
- audit posture
- verification result
- approvals / overrides

This should feel like durable record inspection, not like dropping the operator into raw logs.

## Relationship To Current Surfaces

This separation must remain explicit.

### Live Workstation

- current execution context
- transcript-first
- focused on what is happening now

### Session History

- durable record browsing
- focused on what sessions exist and how to inspect them

### Timeline

- meaningful progression inside one session

### Audit

- inspection of the current trust state inside one session

### Verify

- judgment over whether a session's evidence and governance signals justify a stronger trust posture

Session history is the outer navigation layer over these record-level surfaces.

## Boundaries

This section is the main architectural guardrail.

### Session History Is Not

- a live transcript replacement
- a second workstation
- raw ledger browsing
- release-readiness judgment
- replay or step-by-step execution control

### Session History Is

- durable session navigation
- concise inspection of past or current sessions as records
- the gateway into timeline, artifacts, audit, and verification

## Sorting And Filtering Rules

V1 should stay simple and predictable.

### Sorting

- newest sessions first
- updated time is the default sort key

### Visibility

- active and completed sessions should both be visible
- blocked, failed, and archived sessions should remain inspectable

### Filtering

Optional later filters may include:

- lifecycle outcome
- trust posture
- verification result

V1 should not start with broad search or query syntax.

## CLI Shape Recommendation

The cleanest V1 grammar is:

```bash
dax session list
dax session show <session-id>
dax session inspect <session-id>
```

Why this shape:

- session history belongs under the `session` namespace
- the grammar remains consistent with the rest of DAX
- browsing and inspection stay clearly grouped

## Presentation Model

The first history surfaces should emphasize:

- concise operator-facing labels
- durable outcomes
- trust and verification state
- direct paths into deeper session surfaces

They should not emphasize:

- raw internals
- low-level event payloads
- full transcript rendering by default

## V1 Non-Goals

The first history surface should not include:

- full-text search
- cross-session comparison
- replay engine
- resume workflow redesign
- release-readiness integration
- TUI history browser

These may become later consequences of a strong session-history model, but they should not be mixed into V1.

## Acceptance Signals

The session history surface is successful when an operator can:

- find a recent session quickly
- understand its state quickly
- inspect its progression and trust outcome
- move into timeline, artifacts, audit, or verification without opening the live workstation

## Summary

The cleanest next layer after session, timeline, audit, and verify is:

- a CLI-first session history surface

This is the point where DAX begins acting not just as a governed execution system, but as an operational memory for AI-assisted work.
