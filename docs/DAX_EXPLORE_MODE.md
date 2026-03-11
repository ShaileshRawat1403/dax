# DAX Explore Mode

This document defines Explore mode as a structured repository-understanding mode.

The purpose of Explore is to produce durable, structured repo understanding. It must not collapse into shallow summarization.

## Core Rule

Explore changes what DAX investigates and returns.

Explore does not change:

- DAX persona
- stream voice
- sidebar contract

## Purpose

Explore mode exists to answer:

- where the repo starts
- how execution flows
- what orchestrates the system
- what external systems it integrates with
- what files matter most
- what should be read next
- what remains unknown

## Required Outputs

Explore mode should produce structured outputs that include:

### Entry points

- runtime entry files
- CLI entry points
- service/bootstrap entry points

### Execution flow

- high-level flow through the system
- major transitions or phases

### Orchestration loop

- agent/runtime loop
- coordination cycle
- where control decisions happen

### Integration map

- external services
- providers
- APIs
- MCP or similar integration boundaries

### Important files

- the files that define the system most clearly
- the files that should be read first

### Reading order

- recommended sequence for understanding the repo

### Unknowns

- gaps in certainty
- areas not yet fully traced

### Follow-up targets

- concrete next files or flows to inspect

## Forbidden Outputs

Explore mode must not degrade into:

- shallow repo summaries
- README paraphrasing
- generic prose impressions
- vague architectural claims without file grounding

Bad:

- `This repo seems to be about AI tooling.`
- `The codebase looks well organized overall.`

Good:

- `CLI entry point: packages/dax/src/index.ts`
- `Session workstation route: packages/dax/src/cli/cmd/tui/routes/session/index.tsx`
- `Trust evaluation path flows through trust/verify-session.ts`

## Stream Behavior

The stream remains operator-style.

Examples:

- `Identifying repository entry points`
- `Mapping orchestration flow`
- `Collecting integration boundaries`
- `Preparing reading order`

Never:

- conversational repo narration
- ELI12 stream voice
- speculative summary language

## Overlay / Output Behavior

Explore results may appear in:

- inspect-like overlays
- explore reports
- structured CLI output

The output should remain:

- structured
- file-grounded
- easy to continue from

## Explore + ELI12

Explore may run with ELI12.

In that case:

- stream still remains operator-style
- explanations become simpler
- structure remains intact

This means Explore + ELI12 should produce:

- simple explanations
- not shallow outputs

## Product Guardrail

If Explore returns vague impressions, it has failed.

If Explore returns structured, file-grounded understanding with explicit unknowns and next steps, it is working.
