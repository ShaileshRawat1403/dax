# DAX Mode Model

This document defines the mode system for DAX.

Modes change task framing and explanation behavior. They do not change DAX's core identity as an execution operator.

## Core Rule

DAX always remains an execution operator.

Modes may change:

- what DAX investigates
- what DAX returns
- how overlays explain results

Modes may not change:

- the core persona
- the stream voice
- the sidebar contract

## Mode Set

### Operator

Operator is the default runtime mode.

Purpose:

- execute workflows
- narrate progress
- surface state
- escalate when intervention is required

Surface behavior:

- stream: operator narration
- sidebar: factual summaries
- overlays: inspect-first explanations

### ELI12

ELI12 is an explanation modifier.

Purpose:

- make explanations accessible to non-developers
- reduce jargon in overlays and guided output
- preserve the operator environment

Surface behavior:

- stream: unchanged
- sidebar: unchanged
- overlays: simpler explanations
- help/guided flows: simpler explanations

ELI12 is not a narration mode.

### Explore

Explore is a task mode for repository understanding.

Purpose:

- understand architecture
- map execution flow
- identify orchestration loops
- locate important files and integrations

Surface behavior:

- stream: operator narration about exploration steps
- sidebar: unchanged factual summaries
- overlays: explore results may appear in inspect/explore-style surfaces

Explore does not change DAX into a summarizer or explainer assistant.

## Inheritance Rules

### Stream

The stream always remains operator-style in every mode.

Examples:

- `Scanning repository`
- `Mapping orchestration flow`
- `Collecting integration points`
- `Approval required`

Never:

- first-person voice
- second-person advice
- ELI12 narration

### Sidebar

The sidebar is always factual.

It remains:

- concise
- state-based
- non-explanatory

Modes do not change the sidebar into an explanation surface.

### Overlays

Overlays may vary by mode.

Operator mode:

- concise evidence and operator-facing summaries

ELI12:

- simplified explanations
- reduced jargon
- clearer causal wording

Explore:

- structured repository understanding results

## Activation Model

ELI12 should support both:

- session-level activation
- command-level override

Examples:

- `dax --eli12`
- `dax inspect --eli12`

Explore should support:

- explicit command or mode entry
- task-oriented invocation

Examples:

- `dax explore`
- `dax inspect --mode explore`

Operator mode is the default when no other mode is set.

## Non-Goals

Modes are not:

- personalities
- themes
- UI skins
- separate products

Modes should not create incompatible stream or sidebar behavior.

## Product Guardrail

If a mode makes DAX sound like a different personality, the mode is wrong.

If a mode changes task framing or explanation depth while preserving the execution-operator identity, the mode is correct.
