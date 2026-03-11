# DAX Explore Implementation Plan

This document defines the next implementation layer for Explore now that the repo-explore engine is product-credible.

The purpose of this phase is not to deepen the engine again by default.

The purpose is to expose Explore as a first-class product capability without breaking the execution-operator model.

## Why This Phase Starts Now

Explore now has:

- a stable output contract
- a real pass pipeline
- a CLI surface
- repeated local-repo validation
- honest behavior on both strong and weak repos

The question is no longer:

- is the engine usable?

The question is now:

- how should Explore be promoted into broader DAX plumbing?

## Core Rule

Promote Explore through controlled plumbing, not broad UI expansion.

That means:

1. mode plumbing
2. operator routing
3. CLI/session entry consistency
4. `ELI12` behavior
5. only later workstation exposure

## Scope

This phase includes:

- Explore mode plumbing
- Explore operator routing
- Explore invocation path unification
- explicit `ELI12` support over Explore output
- session-aware Explore entry behavior

This phase does not include:

- TUI Explore pane or workstation embedding
- interactive Explore navigation
- new Explore passes unless validation reveals a repeated failure
- generic “chat about the repo” behavior

## Product Goal

Make Explore feel like a real DAX capability rather than a standalone command.

The user should be able to invoke Explore consistently and get:

- repository shape
- entry points
- execution graph
- orchestration loop
- integrations
- important files
- reading order
- unknowns

without it feeling like:

- a README summary
- a random inspect helper
- a different personality

## Architecture Direction

The canonical Explore chain should be:

`explore_repo -> Explore operator -> repo-explore skill -> output surface`

This means:

- `explore_repo` is the task intent
- the Explore operator owns task framing
- the repo-explore skill owns evidence gathering and report construction
- the output surface renders the fixed Explore contract

## Implementation Sequence

### 1. Explore Mode Plumbing

Add Explore as a first-class mode in runtime plumbing.

Responsibilities:

- set task framing to repository understanding
- preserve execution-operator stream tone
- select Explore output behavior instead of generic execution behavior
- support command-level or session-level activation

Initial entry targets:

- `dax explore [path]`
- internal mode selection that can later back:
  - `dax --mode explore`
  - session-scoped Explore invocations

Guardrails:

- Explore mode must not turn DAX into a conversational summarizer
- stream voice stays operator-style
- sidebar/workstation contracts stay unchanged

### 2. Explore Operator Routing

Introduce or formalize the Explore operator as the task-level owner.

Responsibilities:

- accept `explore_repo` intent
- choose the repo-explore skill
- invoke the fixed report pipeline
- return structured Explore output

Responsibilities it must not take:

- ad hoc repo prose generation
- freeform architecture speculation
- mixing Explore with execution control or mutation behavior

### 3. CLI / Session Entry Unification

Unify how Explore is invoked from product surfaces.

Required behavior:

- CLI command remains canonical and stable
- future session-based invocations should call the same Explore operator path
- no duplicate Explore logic in command handlers

The rule should be:

- command surface selects Explore
- operator path runs Explore
- renderer outputs Explore contract

### 4. Explore + ELI12

Explore should explicitly support `ELI12` as an explanation modifier.

Requirements:

- keep the same section order
- keep `Observed / Inferred / Unknown`
- keep file-grounded structure
- simplify explanation wording only

Examples:

- normal:
  - `Observed: server bootstrap hands control into application modules`
- `ELI12`:
  - `Observed: the server start file passes work into the main app modules`

What must not change:

- confidence labels
- evidence markers
- unknown handling
- reading order structure

### 5. Deferred Workstation Exposure

Do not place Explore into the workstation yet.

Explore is ready for broader plumbing, but not yet for always-on exposure.

The right later sequence is:

1. prove mode/operator/session plumbing
2. validate Explore usage through those surfaces
3. only then design:
  - Explore overlay
  - inspect integration
  - workstation discoverability

## Internal Responsibility Split

### Repo-Explore Skill

Owns:

- passes
- evidence collection
- confidence and evidence markers
- report synthesis

Must not own:

- mode state
- session selection
- broad UI decisions

### Explore Operator

Owns:

- task framing
- skill selection
- invocation path
- output selection

Must not own:

- low-level pass heuristics
- freeform architecture narration

### Output Surface

Owns:

- CLI rendering
- JSON rendering
- `ELI12` rendering variant

Must not own:

- evidence gathering
- task routing

## Acceptance Signals

This phase is complete when:

1. Explore can be invoked through a first-class mode/operator path, not only as a standalone command.
2. `ELI12` works on top of Explore without breaking structure or honesty.
3. CLI and future session-based Explore entry points share the same backend path.
4. Explore still behaves like repo dissection, not repo chat.
5. No workstation/TUI coupling is required for Explore to feel like a product feature.

## Non-Goals

This phase is not trying to:

- make Explore perfect on every repo type
- solve mixed-language tracing generally
- build interactive architecture browsing
- expose Explore everywhere at once

## Recommended Next Implementation Slice

The first concrete slice should be:

- formal Explore operator routing plus mode plumbing

That is the smallest move that promotes Explore from:

- strong CLI engine

to:

- first-class DAX capability
