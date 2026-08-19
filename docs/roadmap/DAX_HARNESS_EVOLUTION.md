---
title: DAX Harness Evolution Roadmap
archetype: roadmap
status: proposed
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - agent-harness
  - roadmap
  - runtime
  - governance
last_reviewed: 2026-08-17
---

# DAX Harness Evolution Roadmap

## Purpose

This roadmap turns comparative harness research into bounded DAX evolution. It complements the product release roadmap and does not assign release numbers.

The objective is to build a best-of-class harness without changing DAX's intent:

> DAX is the governed execution authority for AI-assisted software work.

DAX should support both:

1. a strong native agent harness
2. a harness above external harnesses, where DAX owns scope, isolation, evidence, verification and approval

## North-Star Runtime

```text
Intent
→ governed context
→ immutable execution contract
→ native agent or governed worker
→ mediated capabilities
→ canonical event truth
→ verification and proof
→ operator decision
```

The model or external worker may propose work. DAX remains the execution, approval, recovery and evidence authority.

## Baseline

DAX v1.3.0 already provides:

- canonical run events and deterministic replay
- RAO approval and override semantics
- execution contracts and mutation budgets
- typed native tools and plugin hooks
- context selection, pruning and summarisation
- forked and resumable task sessions
- governed workflows with an event-level test harness
- disposable external-worker checkouts
- containment, process cleanup, egress evidence and verification receipts
- Rust replay, policy, audit and ledger proof surfaces

The roadmap therefore prioritizes integration depth over feature accumulation.

## Guardrails

Every harness-derived change must satisfy these rules:

1. DAX remains the standalone governed coding runtime.
2. The change strengthens native execution or governed-worker execution.
3. Runtime authority cannot move into a plugin, model, provider or companion product.
4. Every consequential action remains contract-bound and policy-mediated.
5. Model-visible context remains reconstructable.
6. Verification and evidence remain independently computed where possible.
7. Rust is used for deterministic proof boundaries, not adopted merely because another harness uses Rust.
8. New abstraction must replace duplication or enforce an invariant.

## Workstream Sequence

### H0 - Comparative Baseline

**Goal:** establish evidence before changing architecture.

Deliverables:

- one repeatable cross-harness task scenario
- a DAX trace from intent through completion proof
- a DeepSeek trace of the same scenario
- failure injections for denial, cancellation, overflow and interruption
- a capability matrix scored as absent, partial, equivalent or leading
- explicit Adopt, Adapt, Defer or Reject decisions

Exit criteria:

- every proposed architecture change references an observed failure, invariant or measurable simplification
- no roadmap item exists only because another agent exposes the feature

### H1 - Canonical Runtime Truth

**Goal:** make prompt inputs, runtime actions and operator projections traceable to one durable truth model.

Deliverables:

- source references for every model-visible prompt contribution
- canonical event identities across session, run, workflow, worker and RAO projections
- explicit projection contracts for artifacts, approvals, trust and completion evidence
- universal event-order and projection-conformance tests
- compatibility policy for historical event formats

Exit criteria:

- a completed run can reconstruct the effective model context and consequential execution history from durable records
- native tools, workflows and governed workers cannot report completion through an untracked path

### H2 - Governed Tool Protocol

**Goal:** give every consequential capability one execution protocol.

Deliverables:

- runtime-validated input and canonical output schemas
- separate pre-policy, approval, guard, wrapper, execution and post-policy stages
- monotonic guards that later stages cannot weaken
- stable cancellation, timeout and concurrency semantics
- immutable final observations
- adapters for native tools, plugin tools and workflow actions
- boundary receipts for external workers

Exit criteria:

- equivalent tool requests receive equivalent governance regardless of entry surface
- malformed outputs cannot enter context, evidence or projections as valid observations

### H3 - Governed Capability Seams

**Goal:** make infrastructure replaceable without making governance replaceable.

Initial seams:

1. filesystem
2. subprocess and shell
3. sandbox
4. model provider
5. external worker

Deliverables:

- versioned capability contracts
- provider capability descriptors
- fail-closed selection when a provider cannot satisfy the execution contract
- scoped provider lifecycle and deterministic disposal
- provider-independent policy and evidence adapters

Exit criteria:

- local and isolated providers can be exchanged without rewriting consumers
- no provider can bypass DAX policy, approvals or canonical observations

### H4 - Transactional Context and Compaction

**Goal:** make context reduction durable, recoverable and observable.

Deliverables:

- compaction start, completion and failure events
- one active compaction per session surface
- stable-range validation
- tool-call and result boundary preservation
- token measurements before and after reduction
- provider-overflow recovery policy
- cancellation and crash recovery tests
- provenance from compacted summaries to replaced events

Exit criteria:

- interrupted compaction cannot create an ambiguous model-visible surface
- replay derives the same active context surface after restart

### H5 - Governed Subagent Runtime

**Goal:** evolve resumable task sessions into controlled, continuable child runs.

Deliverables:

- durable parent-child lineage
- provider capability descriptors
- direct-parent messaging authority
- delegation depth and child-count limits
- child tool, path, token, time and mutation budgets
- FIFO follow-up admission and cold resume
- explicit interrupt, settlement and child-first disposal
- completion, cancellation and cleanup receipts

Exit criteria:

- child agents cannot gain capabilities not granted by the parent contract
- every child action remains attributable to its lineage and execution budget
- recovery cannot create two live authorities for the same child session

### H6 - Proof-Ladder Integration

**Goal:** make deterministic proof surfaces part of the live authority path.

Deliverables:

- live Rust policy authority for claimed policy decisions
- hash-chain integration with canonical event emission
- audit posture derived from canonical observations
- proof receipts linked to run and session identities
- parity tests between TypeScript projections and Rust replay
- explicit behavior when a proof service is unavailable or mismatched

Exit criteria:

- DAX can demonstrate what happened, why it was allowed, whether evidence is sufficient and whether the event chain is intact
- proof claims do not depend on post-hoc reconstruction from incomplete adapters

### H7 - Continuous Harness Research

**Goal:** learn continuously without accumulating unrelated features.

Study order:

| Harness | Primary lesson |
| --- | --- |
| DeepSeek Harness | Session-event coherence, capability seams, tool pipeline, compaction and continuable subagents |
| OpenAI Codex | Rust execution runtime, sandboxing, approvals, process orchestration and production CLI resilience |
| Pi Agent Harness | Minimal separable agent core, extension model and terminal rendering |
| mini-SWE-agent | Minimal linear loop, stateless execution and evaluation baseline |
| OpenCode | Multi-provider architecture, client/server separation, LSP and TUI ergonomics |
| OpenHands | Local, container and remote runtimes plus long-running agent control |
| Aider | Repository maps, edit formats, Git integration and test/lint feedback loops |
| Goose | MCP extension distribution, portability and embedded-agent packaging |
| Gemini CLI | Extensions, authentication, policy modes and headless operation |
| Qwen Code | Agent teams, skills, memory, daemon mode and multi-protocol interfaces |

Codex is primarily Rust while DAX is TypeScript with targeted Rust proof crates. The research unit is therefore the invariant and boundary contract, not source-code portability.

For every harness:

1. trace the standard comparison scenario
2. identify the protected invariant
3. locate the implementation boundary
4. compare the DAX equivalent
5. record Adopt, Adapt, Defer or Reject
6. implement only after a DAX acceptance test exists

## Priority Order

| Priority | Workstream | Reason |
| --- | --- | --- |
| P0 | H0 Comparative Baseline | Prevent architecture-by-imitation |
| P0 | H1 Canonical Runtime Truth | Foundation for every later proof and lifecycle improvement |
| P0 | H2 Governed Tool Protocol | Closes the largest execution-coherence gap |
| P1 | H3 Governed Capability Seams | Enables safe provider substitution without a rewrite |
| P1 | H4 Transactional Context and Compaction | Improves long-run reliability and recovery |
| P1 | H5 Governed Subagent Runtime | Adds controlled delegation after authority is coherent |
| P1 | H6 Proof-Ladder Integration | Completes DAX's strongest trust claim |
| Continuous | H7 Harness Research | Feeds evidence into the bounded workstreams |

H1 and H2 should precede major subagent expansion. More agents running over ambiguous state would amplify drift rather than improve the harness.

## Success Measures

| Dimension | Target |
| --- | --- |
| Model-visible provenance | 100% of prompt contributions carry durable source references |
| Tool protocol coverage | 100% of consequential native and plugin tools use the governed protocol |
| Projection conformance | Native, workflow and worker projections pass the same event-harness tests |
| Recovery | Interrupted runs and compactions reconstruct without ambiguous active state |
| Subagent authority | 100% of child actions resolve to a parent contract and bounded capability set |
| Proof integrity | Live events, policy decisions, audit posture and ledger identities agree |
| Regression control | Existing DAX v1.3 governance and worker tests remain passing |

## Non-Goals

- feature parity with every coding agent
- replacing the DAX workstation with another harness UI
- rewriting DAX in Rust
- adopting Cordis as a prerequisite
- unrestricted autonomous agent teams
- model-generated trusted plugins
- general-purpose automation unrelated to governed software work
- weakening human intervention to improve benchmark speed

## Immediate Next Gate

Before implementation begins:

1. freeze the comparative task scenario
2. trace it through DAX v1.3.0 and DeepSeek Harness
3. define the canonical-event acceptance tests for H1
4. define the tool-protocol state machine for H2
5. stop for architecture review before changing the live runtime

## Related Documents

- [DeepSeek Harness Comparative Study](../architecture/DEEPSEEK_HARNESS_COMPARISON.md)
- [DAX Execution Model](../architecture/DAX_EXECUTION_MODEL.md)
- [DAX Event-Driven Lifecycle](../architecture/DAX_EVENT_DRIVEN_LIFECYCLE.md)
- [DAX Subagent Model](../architecture/DAX_SUBAGENT_MODEL.md)
- [Rust Proof Ladder](../architecture/RUST_PROOF_LADDER.md)
- [Product Roadmap](../product/ROADMAP.md)
