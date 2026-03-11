# DAX Explore Output Contract

This document defines the stable user-facing deliverable for Explore mode.

`DAX_EXPLORE_EXECUTION_GRAPH.md` defines how Explore investigates a repository.

This document defines what Explore must return every time.

## Core Rule

Explore output must be structured, file-grounded, and repeatable.

It must not drift into:

- generic repo summary
- README paraphrase
- vague architecture prose
- ungrounded interpretation

## Required Section Order

Explore output must always use this section order:

1. `Repository shape`
2. `Entry points`
3. `Execution graph`
4. `Orchestration loop`
5. `Integrations`
6. `Important files`
7. `Suggested reading order`
8. `Unknowns / follow-up targets`

This order is part of the contract.

## Section Requirements

### 1. Repository Shape

Must describe:

- repo roots
- workspace or monorepo boundaries
- major packages, apps, or services
- major runtime or build domains

### 2. Entry Points

Must identify:

- CLI entry points
- server entry points
- worker entry points
- TUI entry points
- other real runtime starts when present

Must distinguish:

- actual runtime entry points
- reusable exported modules

### 3. Execution Graph

Must describe:

- how work moves through the system
- task/request/session flow
- major handoffs
- important transitions

This should read as execution structure, not general architecture prose.

### 4. Orchestration Loop

Must describe:

- coordination cycle
- where control decisions occur
- where pause/resume or approvals happen
- what loop or workflow spine drives the product

### 5. Integrations

Must describe:

- providers
- MCP
- external APIs
- storage
- queues
- CI hooks
- auth/config boundaries

### 6. Important Files

Must include:

- the most important files for understanding the repo
- short role labels for each file

### 7. Suggested Reading Order

Must provide:

- an ordered reading sequence
- each step tied to a file or small set of files
- a reason for the order

### 8. Unknowns / Follow-Up Targets

Must include:

- unresolved questions
- unconfirmed flows
- specific next files, directories, or boundaries to inspect

## Confidence Labels

Each major section must include one confidence label:

- `high confidence`
- `medium confidence`
- `low confidence`
- `unknown`

Confidence applies to the section as a whole.

## Evidence Markers

Within sections, each key point should be marked as one of:

- `Observed`
- `Inferred`
- `Unknown`

### Observed

Directly grounded in files, symbols, or config.

### Inferred

Supported by evidence but not fully confirmed end-to-end.

### Unknown

Not confirmed from the scanned evidence.

## File Citation Expectations

Claims should cite files whenever possible.

Good:

- `Observed: CLI entry point at packages/dax/src/index.ts`
- `Observed: workstation route at packages/dax/src/cli/cmd/tui/routes/session/index.tsx`

Bad:

- `The repo appears to have a CLI layer`
- `There is probably a runtime loop somewhere in session handling`

If a claim cannot cite a file or a directly grounded boundary, it should usually be `Inferred` or `Unknown`, not `Observed`.

## Reading Order Format

Suggested reading order should use a numbered sequence.

Each item should include:

- file or files
- why it comes next

Example:

```text
1. packages/dax/src/index.ts
   Reason: establishes the CLI entry surface.

2. packages/dax/src/session/index.ts
   Reason: shows how session runtime is coordinated after entry.

3. packages/dax/src/cli/cmd/tui/routes/session/index.tsx
   Reason: shows how runtime state appears in the workstation.
```

## Unknowns / Follow-Up Format

Unknowns and follow-up targets should be concrete.

Good:

- `Unknown: queue backend not confirmed`
- `Follow-up: inspect provider initialization under packages/dax/src/provider/*`
- `Follow-up: confirm whether background jobs start outside CLI entry`

Bad:

- `More exploration may be needed`
- `Some areas are unclear`

## Normal vs ELI12

The structure does not change between normal Explore and ELI12 Explore.

Only explanation depth changes.

### Normal

- concise
- technical
- file-grounded

### ELI12

- simpler wording
- reduced jargon
- same section order
- same evidence markers
- same honesty rules

ELI12 may simplify the explanation of a finding, but it must not remove:

- confidence labels
- observed/inferred/unknown markers
- file grounding
- unknowns

## Example Output Shape

```text
Repository shape
Confidence: high
- Observed: canonical runtime under packages/dax
- Observed: TUI and CLI surfaces live under packages/dax/src/cli

Entry points
Confidence: high
- Observed: CLI entry at packages/dax/src/index.ts
- Observed: session workstation route at packages/dax/src/cli/cmd/tui/routes/session/index.tsx

Execution graph
Confidence: medium
- Observed: session-oriented work flows through session/*
- Inferred: governance and trust evaluation feed workstation truth summaries

Orchestration loop
Confidence: medium
- Observed: stable product loop aligns with plan -> run -> approvals -> artifacts -> audit
- Inferred: workstation overlays reflect the same loop as evidence surfaces

Integrations
Confidence: medium
- Observed: provider auth plugins and MCP entry points exist
- Unknown: queue backend not confirmed

Important files
- packages/dax/src/index.ts — CLI entry surface
- packages/dax/src/session/index.ts — session runtime coordination
- packages/dax/src/trust/verify-session.ts — trust evaluation

Suggested reading order
1. packages/dax/src/index.ts
   Reason: establishes runtime entry.
2. packages/dax/src/session/index.ts
   Reason: shows session control flow.
3. packages/dax/src/cli/cmd/tui/routes/session/index.tsx
   Reason: shows workstation presentation.

Unknowns / follow-up targets
- Unknown: full background-job entry surface not confirmed
- Follow-up: inspect provider initialization under packages/dax/src/provider/*
```

## Product Guardrail

If two Explore runs on the same repo return wildly different structure, the output contract is not strong enough.

If Explore consistently returns the same section order, evidence style, and honesty model, the contract is working.
