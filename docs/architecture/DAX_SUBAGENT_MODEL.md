---
title: DAX Sub-Agent Model
archetype: architecture
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - subagents
last_reviewed: 2026-08-19
---

# DAX Sub-Agent Model

This document defines sub-agents as specialist operators within DAX.

Sub-agents are bounded expertise layers. They are not separate personalities.

## Core Rule

Sub-agents inherit the current mode and voice contract.

They may change:

- scope of expertise
- workflow focus
- output structure

They may not change:

- DAX persona
- stream tone
- sidebar behavior

## Purpose

Sub-agents let DAX specialize without fragmenting the product into multiple chat identities.

They provide:

- bounded expertise
- clearer workflow ownership
- reusable domain-specific task framing

## Initial Sub-Agent Set

> **Status note**: the set below (Git, Explore, Verify, Release, Artifact)
> describes DAX's **operator** layer
> (`packages/dax/src/operators/{git,explore,verify,release,artifact}.ts`,
> registered in `packages/dax/src/operators/router.ts:29-37`). Native
> task-tool subagents (spawned via the `task` tool with a forked session,
> `packages/dax/src/tool/task.ts:40`) are `general`, `agile`, `lean`, and
> `ts-expert` (`packages/dax/src/agent/agent.ts:154-213`); `explore` is a
> primary-mode agent (`agent/agent.ts:247`). This document's product model is
> the operator layer.

### Git

Responsibilities:

- repository status
- diffs
- branch state
- commit preparation

### Explore

Responsibilities:

- architecture mapping
- execution flow
- orchestration loop discovery
- integration analysis

### Verify

Responsibilities:

- trust evaluation
- policy checks
- evidence review
- verification reporting

### Release

Responsibilities:

- readiness evaluation
- blockers
- missing evidence
- handoff and shipping judgment

### Artifact

Responsibilities:

- artifact inventory
- retained output classification
- grouping and inspection of outputs

## Mode Inheritance

Sub-agents inherit the active mode.

Examples:

Git in Operator mode:

- `Collecting staged changes`
- `Preparing commit summary`

Git in ELI12:

- explanation surfaces may say what staged changes mean in simpler language

Explore in Explore mode:

- `Identifying repository entry points`
- `Mapping orchestration flow`

The stream remains operator-style in every case.

## UI Rule

Sub-agents should not introduce a separate UI voice.

They should appear as:

- specialist execution context
- specialist overlay or output structure
- specialist task framing

They should not appear as:

- separate characters
- separate chat personas
- competing assistants

## Surface Boundaries

### Stream

Sub-agent activity may influence the subject of narration, but not the tone.

### Sidebar

Sub-agents should not alter the sidebar contract.

### Overlays

Sub-agents may influence overlay structure and evidence emphasis.

Examples:

- Verify agent emphasizes checks and degradation reasons
- Release agent emphasizes blockers and missing evidence
- Explore agent emphasizes maps, entry points, and reading order

## Non-Goals

Sub-agents are not:

- autonomous personalities
- marketing roles
- user-facing mascots

They should never force a new stream persona.

## Product Guardrail

If a sub-agent feels like “a different assistant,” the model is wrong.

If a sub-agent feels like a specialist operator working within the same control plane, the model is correct.
