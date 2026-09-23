---
title: DAX Roadmap
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.2.0
tags:
  - dax
  - product
  - roadmap
---

# DAX Roadmap

Current baseline: **DAX v1.5.0**, released 2026-09-20. The next sprint focuses
on the nine remaining conformance gaps. The older release plan below is retained
as historical context.

## Next Sprint — Conformance Closure

Implementation model: Sol. Reviewer: Astra 6 high.
Status: in progress. Reviewed `main` record-class coverage is 10/11; all nine aggregate
gaps remain open in the [sprint backlog and acceptance plan](../roadmap/CONFORMANCE_SPRINT.md).
See [current status](../DAX_STATUS.md) for the integrated commit and validation evidence.
Compaction-replacement provenance is the current implementation candidate and
targets 11/11 and closure of the record-class gap only after independent review
and integration. Eight other aggregate gaps require their own work.

| Workstream | Gaps | Intended outcome |
| --- | --- | --- |
| Complete event history | 1 | Reconstruct prompt, context, assistant, delegation, and compaction history from durable records. |
| Shared capability permissions | 4 | Name capabilities, validate their properties, express contract grants, and enforce them consistently across execution paths. |
| Project scope and governed memory | 4 | Reuse journal machinery, identify event ownership, persist project facts, and connect an authorized memory writer. |

Dependencies determine implementation order: project journaling and grant
resolution precede memory promotion. Completion requires production behavior and
regression evidence; a file-existence check is insufficient. Unfinished work stays
open in the ledger and is explicitly carried forward at sprint review. No release
number or calendar deadline is committed yet.

The two integrity gaps closed in v1.5.0 remain regression requirements, not new
backlog items. The historical v1.4.0 claims pack remains frozen.

## Discussion backlog — bounded advisory checks

Recorded 2026-09-22. **Idea only: unscheduled, not approved for implementation.**
This does not add work to the active conformance sprint.

Explore Jev's pattern of narrow independent questions against one stable snapshot,
adapted to DAX's existing Shadow Auditor. The candidate questions are whether a
compiled contract matches the user's intent and whether its validation plan would
demonstrate the requested outcome. DAX retains execution and approval authority.

Before runtime development, discuss a small evaluation comparing the current
single audit, one structured call answering both questions, and two concurrent
calls using existing providers. Use the same manually reviewed cases and compare
useful findings, missed problems, false alarms, latency, and usage. Concurrent
calls must earn their added cost; they do not reproduce Jev's internal model
architecture or establish calibrated confidence.

Any later pilot would remain optional and advisory, with bounded input, timeouts,
and explicit unavailable results. The current auditor runs asynchronously; this
idea does not promise assessment before execution. Authorization changes,
parallel coding workers, a generic judgment framework, cross-project rollout,
and Jev API integration are outside this candidate's initial scope. No new
conformance claim or gap closure follows from an advisory experiment.

## Historical Phase-3 Roadmap

The sections below preserve the earlier v1.0.9–v1.2.x product direction.

## Product Direction

DAX is moving from “impressive internal system” to “ready-to-use governed execution product.”

That means the next releases should focus on:

- truthful readiness
- first-run clarity
- stronger operator workflows
- multi-surface governance

## Release Path

```mermaid
flowchart LR
    A[v1.0.9<br/>Production readiness] --> B[v1.0.10<br/>Refine operator contract]
    B --> C[v1.1.x<br/>Approval inbox and richer governance]
    C --> D[v1.2.x<br/>Govern external coding workers]
    style A fill:#2f936e,stroke:#1f6148,color:#fff
    style B fill:#2b6f9b,stroke:#1a4764,color:#fff
    style C fill:#3a7ca5,stroke:#234c66,color:#fff
    style D fill:#6f4ea5,stroke:#452f68,color:#fff
```

## `v1.0.10` — Refine Becomes an Operator Contract

Theme:

> DAX starts turning prompt refinement into a governed execution-planning surface.

Focus areas:

- refine contract v2
- clearer repo impact and governance forecasting
- better right-pane control rail
- more useful finish states and operator next moves
- sharper DAX-native TUI polish

Success means:

- refine feels like a real operator tool, not just prompt cleanup
- the right pane explains where the live run is going and what to do next
- completed runs end with helpful operator moves when the state warrants them
- the DAX theme and session surfaces feel deliberate again

## `v1.0.9` — Production Readiness

Theme:

> DAX becomes easier to trust, easier to understand, and more coherent to operate.

Focus areas:

- truthful doctor/readiness output
- first-run operator guidance
- cleaner governance language
- release surface alignment
- stronger default theme and operator chrome

Success means:

- a new user can install DAX and understand the first useful action quickly
- setup issues are explained cleanly
- approvals, diffs, and pauses feel coherent
- release notes, versioning, and docs tell one story

## `v1.1.x` — Richer Governance Workflows

Theme:

> DAX approvals become a complete operator workflow, not just a TUI surface.

Likely priorities:

- richer approval inbox
- better grouping of approvals and proposed changes
- stronger “why paused / what next” surfaces
- improved review and sign-off workflows
- more durable release and handoff operations

## `v1.2.x` — Govern External Coding Workers

Theme:

> Bring your own coding agent; keep DAX governance.

Priorities:

- disposable worker checkouts with kernel-computed diffs
- operator-authored or confirmed scope and verification contracts
- DAX-owned verification receipts before review
- OS isolation that fails closed when unavailable
- Flowright capability receipts without duplicate run authority

Remote operator continuity remains a later suite concern. It does not belong
inside the DAX worker proof and should not widen this release.

## What Not To Do Too Early

The roadmap should avoid spending the next releases on:

- more architecture churn without product payoff
- generic assistant features that do not strengthen DAX’s identity
- integrations that add surface area without improving operator control

## Product Principle

Each release should strengthen this sentence:

> DAX is the governed execution workstation for AI-driven software work.

If a feature makes DAX look more like a generic coding assistant, it is probably lower priority than it first appears.

## Related Guides

- [Positioning](./POSITIONING.md)
- [What Is DAX?](./WHAT_IS_DAX.md)
- [Release Readiness](./release-readiness.md)
