# DAX Next Product Decision

## Current State

DAX now has:

- a stable operator grammar: `plan -> run -> approvals -> artifacts -> audit`
- a session-centered execution model
- a workstation UI that reflects lifecycle state
- artifact and audit visibility
- trust posture surfaced as an inspect-first summary

At this point, DAX answers the operator question:

- `What is happening right now?`

It does not yet fully answer:

- `What happened before?`
- `What evidence proves this outcome?`
- `Is this session ready for handoff or release?`

That is the next product layer.

## Decision Options

### Option 1: Session Depth

Make sessions into more durable operational objects.

Possible directions:

- session history
- timeline view
- step replay
- resumable sessions
- session comparison
- cross-session artifact lineage

Operator question:

- `What happened during this work lifecycle?`

### Option 2: Trust Depth

Move from trust summary to stronger trust verification.

Possible directions:

- audit verification
- evidence completeness checks
- release readiness
- override traceability
- policy gates
- trust posture ladder or score

Operator question:

- `Can this work product be trusted?`

### Option 3: Workstation Information Architecture

Expand the workstation beyond a single session screen.

Possible directions:

- session list view
- session timeline mode
- artifact inspection mode
- audit drilldown surfaces
- operational dashboard layers

Operator question:

- `Where should I look in the system?`

### Option 4: Surface Strategy

Choose the long-term interface strategy deliberately.

Possible directions:

- Solid/OpenTUI remains the primary workstation
- a Ratatui rewrite becomes the long-term TUI path
- a web workstation becomes the secondary surface
- the CLI remains the canonical control plane across all surfaces

Operator question:

- `Where does DAX live?`

## Recommended Next Layer

The best next move is:

## Session Depth + Trust Depth

The workstation already visualizes active execution.

The next questions DAX must answer are:

- `What happened?`
- `What evidence exists?`
- `Can this output be trusted?`

This would move DAX from:

- execution control plane

to:

- accountable execution system

## Why This Should Come Next

Right now DAX can:

- plan work
- execute work
- gate work
- show outputs
- show trust posture

It does not yet fully answer:

- how the session got here
- what evidence supports the outcome
- whether the result is ready for review, handoff, or release

Those are the questions that turn the system from a runtime into a stronger system of record for AI-assisted work.

## Recommended Next Design Exploration

If DAX chooses session depth plus trust depth, the next design documents should likely be:

- `DAX_SESSION_MODEL_V2.md`
- `DAX_SESSION_TIMELINE.md`
- `DAX_TRUST_MODEL.md`
- `DAX_AUDIT_VERIFICATION.md`

These should stay in product-modeling and architecture design first, not implementation.

## Decision Rule

Do not continue opportunistic TUI refinement until the next product layer is chosen.

The workstation phase is stable enough.

The next meaningful progress comes from deciding:

- what a session ultimately becomes
- how deep trust should go
- whether DAX will stop at inspectability or continue into verification and handoff readiness

## Recommendation

Choose `session depth + trust depth` as the next deliberate product layer.

That is the clearest path to making DAX more than an execution interface. It is the path toward making DAX the accountable system around AI-assisted work.
