---
title: DeepSeek Harness Comparative Study
archetype: architecture-analysis
status: active
owner: Shailesh Rawat
maintainer: DAX Maintainers
version: 1.0.0
tags:
  - dax
  - agent-harness
  - deepseek-harness
  - architecture
  - governance
last_reviewed: 2026-08-17
---

# DeepSeek Harness Comparative Study

## Purpose

This document compares DAX v1.3.0 with DeepSeek Harness `dsh` 0.1.0-rc.7. It identifies reusable runtime primitives without changing DAX's product intent.

DeepSeek Harness is reference material. No DAX runtime dependency is proposed. DAX should adopt proven invariants and execution semantics selectively.

## Product Boundary

DAX remains the governed execution authority for AI-assisted software work.

```text
Intent
→ context compilation
→ execution contract
→ native agent or governed worker
→ mediated tools
→ canonical events
→ verification
→ evidence
→ operator decision
```

Any borrowed mechanism must enter this lifecycle. It must not create a second execution authority or weaken RAO, execution contracts, completion proof, or the Rust proof ladder.

## Direct Assessment

At this snapshot:

- DAX has an equivalent or partial equivalent for approximately 80% to 85% of DeepSeek's major capability areas.
- DAX reaches approximately 65% to 75% of DeepSeek's integration depth.
- DAX is stronger in execution contracts, approval semantics, governed external workers, independent verification, and completion evidence.
- DeepSeek is stronger in runtime composition, session-event coherence, formal tool execution, transactional compaction, and continuable subagents.

These ranges describe architecture coverage, not model quality or benchmark performance.

## Architectural Alignment

| Capability | DeepSeek Harness | DAX v1.3.0 | Assessment |
| --- | --- | --- | --- |
| Agent loop | Agent loop is a replaceable plugin | Native session processor and governed execution runtime | DAX capable; DeepSeek more composable |
| Session truth | One durable session-event spine | Durable sessions plus canonical run events and proof projections | Strong alignment; DAX has multiple state vocabularies |
| Tool inputs | Runtime-validated schemas | Zod-validated inputs | Aligned |
| Tool outputs | Canonical runtime-validated observations | Structured TypeScript result shape without universal runtime output validation | Partial |
| Tool pipeline | Explicit policy, approval, guards, wrappers, execution, post-policy, immutable result | Permissions, hooks, runtime guards, truncation, worker governance | Strong components; less unified |
| Context | Derived from durable events and capability contributions | Governed context packs and evidence-based selection | Competitive |
| Compaction | Transactional markers, locks, safe ranges, pruning, recovery | Overflow detection, summarisation, pruning | Functional; DeepSeek deeper |
| Subagents | Provider seam, lineage, authority, depth, continuation, cold resume | Permission-gated forked and resumable task sessions | Functional; narrower lifecycle |
| External agents | Codex, Claude Code, ACP and in-process providers | Codex, Claude Code and Gemini as governed workers | DAX stronger governance |
| Permissions | General policy and approvals | Contracts, risk classes, path zones, mutation budgets, approvals, overrides | DAX leads |
| Sandboxing | Replaceable shell, filesystem and sandbox providers | Seatbelt or bubblewrap containment for governed workers | Different coverage |
| Recovery | Durable runtime reconstruction | Replay, interrupted-run classification and `dax recover` | Competitive |
| Plugins | Scoped and reversible service composition | Tool, auth, event and lifecycle hooks | DeepSeek broader |
| Verification | Durable tool outcomes and reconstruction | Diff, mutation and verification receipts plus completion proof | DAX leads |
| Operator control | CLI and web approval surfaces | RAO workstation, trust posture, evidence and intervention surfaces | DAX leads |

## DAX Baseline Evidence

DAX already contains the required foundations:

- `packages/dax/src/tool/tool.ts`: runtime input validation and canonical tool result shape
- `packages/plugin/src/index.ts`: tool, event, permission, auth and lifecycle hooks
- `packages/dax/src/session/compaction.ts`: overflow detection, summarisation and tool-result pruning
- `packages/dax/src/tool/task.ts`: permission-gated session fork and resume
- `packages/dax/src/state/replay.ts`: strict event-order validation and run-state reconstruction
- `packages/dax/src/workflows/workflow-event-harness.ts`: workflow execution against the event store
- `packages/dax/src/worker/*`: disposable workers, containment, egress policy and verification
- `crates/dax-*`: replay, policy, audit and ledger proof surfaces

The main issue is therefore coherence, not absence. Several strong mechanisms still meet through adapters rather than one indisputable runtime protocol.

## Highest-Value Lessons

### 1. Model-visible means logged

If data contributes to a model request, DAX should be able to identify the durable event or immutable source reference that supplied it.

This includes:

- operator intent
- system and project instructions
- selected context
- tool definitions
- approvals and overrides
- tool calls and results
- compaction replacements
- worker evidence
- verification and completion receipts

Derived prompts may remain projections. Their inputs must be reproducible.

### 2. One formal tool execution protocol

The DAX tool lifecycle should become explicit:

```text
request admitted
→ input validated
→ contract and policy evaluated
→ approval resolved
→ monotonic guards applied
→ execution wrappers installed
→ tool executed
→ output validated
→ post-policy evaluated
→ immutable observation emitted
```

Every native tool, plugin tool, workflow action and worker adapter should either use this protocol or publish a documented boundary receipt.

### 3. Capability seams

Separate capability contracts from providers and consumers, beginning with:

- filesystem
- subprocess and shell
- sandbox
- model provider
- external worker

DAX governance remains above each provider. Replacing a provider must not replace policy authority.

### 4. Transactional compaction

Compaction should become a durable state transition rather than only a summary operation.

Required properties:

- start, completion and failure events
- one active compaction per session surface
- stable source range
- preserved tool-call and result pairing
- cancellation and crash recovery
- measurable before and after token state
- explicit retry behavior after provider overflow

### 5. Governed continuable subagents

DAX should extend its existing task-session model with:

- durable parent-child lineage
- direct-parent authority
- delegation depth limits
- child capability and tool budgets
- FIFO follow-up admission
- cold resume
- explicit interrupt and disposal semantics
- child completion and cleanup receipts

The objective is controlled continuation, not autonomous agent swarms.

## Adopt, Adapt, Defer

### Adopt

- model-visible means logged
- formal tool-pipeline stages
- runtime-validated canonical tool outcomes
- capability contract/provider/consumer separation
- transactional compaction markers
- explicit lifecycle ownership and disposal
- event-derived conformance tests

### Adapt through DAX governance

- subagent providers
- per-agent tools and personas
- session forks and continuation
- profile-based capability bundles
- scoped plugin registration
- multiple sandbox and filesystem providers

### Defer or reject

- wholesale Cordis migration
- model-authored runtime plugins
- hot self-modification in the trusted runtime
- making every DAX subsystem dynamically replaceable
- a second UI or event authority
- general automation unrelated to governed software execution
- any capability that bypasses contracts, RAO, evidence, or proof generation

## Comparative Experiment Method

Each harness study should trace the same bounded task:

1. accept intent
2. assemble context
3. request a model action
4. execute one read and one write
5. require approval
6. run verification
7. interrupt or fail one stage
8. recover or resume
9. inspect the durable record

For every difference, record:

| Decision | Meaning |
| --- | --- |
| Adopt | Compatible with DAX invariants and directly reusable |
| Adapt | Valuable after contract, policy and evidence integration |
| Defer | Useful but not currently important to DAX's intent |
| Reject | Introduces duplicate authority, opaque autonomy or avoidable complexity |

## Sources

- [DAX v1.3.0](https://github.com/ShaileshRawat1403/dax/tree/v1.3.0)
- [DeepSeek Harness fork](https://github.com/ShaileshRawat1403/deepseek-harness)
- [DeepSeek architecture](https://github.com/ShaileshRawat1403/deepseek-harness/blob/master/docs/architecture.md)
- [DeepSeek capability seams](https://github.com/ShaileshRawat1403/deepseek-harness/blob/master/docs/capability-seams.md)
- [DeepSeek tool execution pipeline](https://github.com/ShaileshRawat1403/deepseek-harness/blob/master/docs/tool-execution-pipeline.md)
- [DeepSeek compaction subsystem](https://github.com/ShaileshRawat1403/deepseek-harness/blob/master/docs/subsystems/compaction.md)
- [DeepSeek subagent subsystem](https://github.com/ShaileshRawat1403/deepseek-harness/blob/master/docs/subsystems/subagent.md)

## Related DAX Documents

- [DAX Harness Evolution Roadmap](../roadmap/DAX_HARNESS_EVOLUTION.md)
- [DAX Execution Model](./DAX_EXECUTION_MODEL.md)
- [DAX Event-Driven Lifecycle](./DAX_EVENT_DRIVEN_LIFECYCLE.md)
- [Rust Proof Ladder](./RUST_PROOF_LADDER.md)
