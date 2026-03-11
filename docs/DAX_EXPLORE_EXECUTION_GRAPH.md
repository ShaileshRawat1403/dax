# DAX Explore Execution Graph

This document defines how Explore mode should dissect repositories in practice.

The goal is to make Explore a structured repository-understanding workflow, not a summarizer.

## Core Rule

Explore must produce file-grounded structure, not impressions.

If Explore cannot point to:

- files
- symbols
- configuration
- flows
- boundaries

it should return:

- `unknown`
- `unresolved`
- `needs follow-up`

It should not guess.

## Explore Backbone

Explore should operate in five passes.

These passes are ordered. Each pass adds evidence for the next one.

### 1. Boundary Pass

Purpose:

- identify repo roots
- detect workspace boundaries
- detect packages, apps, services, and runtime domains

This pass should find:

- monorepo/workspace structure
- package boundaries
- app/service boundaries
- build domains
- runtime domains

Questions answered:

- what are the top-level execution surfaces?
- what are the major code ownership zones?
- what parts of the repo are likely runtime-bearing versus support-only?

### 2. Entry-Point Pass

Purpose:

- identify real runtime starts

This pass should find actual starts for:

- CLI
- server
- worker
- TUI
- background jobs
- test/bootstrap harnesses when relevant

Critical distinction:

- exported modules are not automatically entry points
- bootstrap and runtime invocation paths are entry points

Questions answered:

- where does execution begin?
- which files are loaded first?
- which files are merely reusable modules?

### 3. Execution-Flow Pass

Purpose:

- trace how execution moves through the system

This pass should trace:

- request flow
- task flow
- session flow
- orchestration loops
- handoffs
- pause/resume transitions
- approval transitions

This is the highest-value pass.

Questions answered:

- how does work actually move through the product?
- where are control decisions made?
- where are interruptions introduced?
- where does execution resume?

### 4. Integration Pass

Purpose:

- map external boundaries

This pass should map:

- providers
- MCP
- external APIs
- storage
- queues
- CI hooks
- auth/config boundaries

Questions answered:

- what external systems does the repo depend on?
- where are those integrations configured?
- what boundaries affect execution and trust?

### 5. Evidence Pass

Purpose:

- convert the findings into durable operator output

This pass should produce:

- important files
- suggested reading order
- unresolved questions
- follow-up targets
- confidence notes

Questions answered:

- what should be read next?
- what remains uncertain?
- what investigation should continue?

## Required Output Sections

Explore output should always use the same top-level structure:

1. `Repository shape`
2. `Entry points`
3. `Execution graph`
4. `Orchestration loop`
5. `Integrations`
6. `Important files`
7. `Suggested reading order`
8. `Unknowns / follow-up targets`

This is the signature output of Explore mode.

## Evidence Honesty Model

Every section should distinguish among:

- `observed`
- `inferred`
- `unknown`

### Observed

Observed means directly grounded in scanned files, symbols, or configuration.

Example:

- `packages/dax/src/index.ts` is a CLI entry point

### Inferred

Inferred means strongly suggested by available evidence, but not directly confirmed end-to-end.

Example:

- this worker likely dispatches background tasks based on imported queue handlers

### Unknown

Unknown means the evidence does not support a confident claim.

Example:

- queue backend not confirmed from scanned files

## Confidence Layer

Each major section should include a confidence label:

- `high confidence`
- `medium confidence`
- `low confidence`
- `unknown`

This keeps Explore honest when analysis is partial.

### Confidence Guidance

High confidence:

- directly grounded in clearly connected runtime files or config

Medium confidence:

- supported by multiple signals but not fully traced

Low confidence:

- weakly supported or partially connected

Unknown:

- not confirmed

## Explore Output Example Shape

```text
Repository shape
Confidence: high
- Observed: workspace packages under packages/*
- Observed: canonical runtime under packages/dax

Entry points
Confidence: high
- Observed: CLI entry at packages/dax/src/index.ts
- Observed: TUI session route at packages/dax/src/cli/cmd/tui/routes/session/index.tsx

Execution graph
Confidence: medium
- Observed: session-oriented runtime flows through session/*
- Inferred: tool execution and governance decisions feed into workstation presentation

Orchestration loop
Confidence: medium
- Observed: stable phases align with plan -> run -> approvals -> artifacts -> audit
- Inferred: workstation presentation reflects the same loop

Integrations
Confidence: medium
- Observed: provider auth plugins and MCP integration points exist
- Unknown: full external dependency graph not fully traced

Important files
- packages/dax/src/index.ts
- packages/dax/src/session/index.ts
- packages/dax/src/trust/verify-session.ts

Suggested reading order
1. packages/dax/src/index.ts
2. packages/dax/src/session/index.ts
3. packages/dax/src/cli/cmd/tui/routes/session/index.tsx

Unknowns / follow-up targets
- Trace queue backend if present
- Confirm background job entry points
```

## What Explore Must Not Become

Explore must not drift into:

- README rewrite
- generic architecture prose
- file-tree narration
- vague impressions

Bad:

- `This repo seems to be about AI tooling.`
- `The architecture looks fairly modular overall.`

Good:

- `Observed: packages/dax/src/index.ts is a CLI entry point`
- `Observed: session workstation route lives at packages/dax/src/cli/cmd/tui/routes/session/index.tsx`
- `Unknown: queue backend not confirmed`

## Product Guardrail

If Explore produces impressions, it has failed.

If Explore produces structured, file-grounded execution understanding with explicit confidence and unknowns, it is working.
