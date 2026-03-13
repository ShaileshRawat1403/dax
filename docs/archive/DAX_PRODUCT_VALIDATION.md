# DAX Product Validation

This document records the first deliberate product-level pause after the major engine phase.

The goal is not to define another subsystem. The goal is to ask:

- what DAX already is as a working system
- what the real product experience should feel like
- what should be tested before more implementation resumes

## Why This Pause Matters

DAX now has enough working layers that it can be evaluated as a product, not only as a set of components.

That means this is the right point to stop adding more surface area and assess:

- CLI operator flow
- session model coherence
- trust and readiness usability
- Explore usefulness
- workstation usability as it stands today

## As-Is

### CLI Surface

DAX already has a credible operator toolchain.

Current working surfaces:

- `run`
- `plan`
- `verify`
- `release check`
- `session show`
- `session inspect`
- `explore`

These commands now cover:

- execution
- planning
- trust judgment
- release judgment
- durable session inspection
- repository understanding

### Session Model

The session model is no longer thin metadata. It is a governed execution record.

Sessions now carry:

- lifecycle
- stage
- trust posture
- verification result
- release readiness
- approvals
- artifacts
- write governance

This is strong enough to treat the session as the core product object.

### TUI / Workstation

The workstation design stack is complete, and parts of the implementation already exist.

Already implemented:

- workstation layout regions
- sidebar truth cards
- narrative stream cleanup
- overlay routing
- approval interruption model
- terminal constraints
- TUI implementation plan

Still incomplete:

- overlay behavior polish
- focus and pane ownership refinement
- terminal collapse behavior
- approval interruption UI polish

### Explore

Explore is now stable enough to stop touching for a while.

It now has:

- boundary pass
- entry-point pass
- integration pass
- execution-flow pass
- evidence synthesis
- CLI surface
- session command surface
- `ELI12` support

Most importantly:

- it is useful on strong repos
- it stays honest on weak repos

That is the correct quality bar.

## To-Be

The target product is not a chatbot and not just a collection of commands.

The target product is:

- a terminal control plane for AI execution

The desired integrated experience is:

- governed execution through sessions
- trust and readiness visible without extra hunting
- repository understanding available when needed
- workstation-first operation for active work
- CLI and session surfaces remaining usable as standalone operator tools

### Target Workstation Shape

The intended workstation remains:

```text
HEADER
Task / Context

-------------------------
Live Execution Stream
-------------------------

Truth Sidebar
Lifecycle
Stage
Trust
Release
Approvals
Artifacts
Write Governance

Footer
[t]imeline [v]erify [r]elease [a]rtifacts [i]nspect [p]rompt
```

Evidence and decision work should continue to live in overlays:

- verify
- release
- artifacts
- timeline
- inspect
- approvals

## What Should Be Tested Now

### 1. CLI Operator Flow

Run realistic command chains such as:

- `run`
- `verify`
- `release check`
- `session inspect`
- `explore`

Questions:

- does the flow make sense without extra explanation
- do outputs feel like parts of one system
- do state transitions read clearly

### 2. Session Lifecycle

Use multiple session shapes:

- lightweight prompt
- artifact-heavy execution
- approval-required work
- failure path

Questions:

- is lifecycle understandable
- do trust and release states feel justified
- is artifact visibility clear enough

### 3. Explore Usefulness

Use:

- `/explore <repo>`

Questions:

- does reading order help
- are entry points accurate enough
- are unknowns honest and useful

### 4. TUI Usability

Even before the workstation is fully complete, test:

- sidebar truth usefulness
- stream narrative quality
- overlay clarity
- keyboard and focus intuition

Questions:

- does the workstation already feel like a control plane
- or does it still feel like partial tooling glued together

## Friction To Watch For

This pause should produce real product friction, not abstract design notes.

Likely friction areas:

- CLI flow feels correct but still too recall-driven
- session state is accurate but too dense
- trust and release signals are defensible but may still feel heavy
- workstation overlays may be structurally right but interaction-light
- Explore is stable, but still not yet integrated into workstation use

## Current Product Assessment

At this point DAX already reads as:

- an AI execution control plane

It does not primarily read as:

- an assistant
- a chatbot
- a generic coding agent

That is a stronger and more distinctive category.

The main unresolved question is no longer category. It is experience:

- does the workstation make the category feel real

## Recommended Next Step

Resume implementation from the workstation layer, not from Explore and not from a new engine feature.

Recommended order:

1. TUI overlay behavior polish
2. focus behavior and pane ownership cleanup
3. terminal collapse and degradation behavior
4. approval interruption UI polish

Session learning remains important, but should stay as a held product track until workstation progress resumes.
