---
title: DAX Deprecation Tracker
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - compatibility
---

# DAX Deprecation Tracker

Last reviewed: 2026-04-28

This document tracks compatibility paths that are still intentionally shipped, why they still exist, and what must be true before they can be removed.

Release rule:

- Deprecated behavior may remain only if it is centralized, observable, and covered by tests.
- Deprecated behavior must not silently redefine DAX authority or execution truth.
- Removal work should happen as an explicit migration task, not as incidental cleanup hidden inside a feature release.

## Active Compatibility Paths

| Surface | Current role | Current guardrail | Removal condition | Owner area |
| --- | --- | --- | --- | --- |
| `CreateRunRequest.metadata.allowLegacyFallback` | Explicit escape hatch when execution-contract creation fails | Deprecated in schema, warned in logs, warned in API response, tested in [run-gateway.test.ts](../../packages/dax/src/server/run-gateway.test.ts) | Remove once all first-party and external callers are confirmed to run without legacy fallback | `packages/dax/src/server` |
| `RunSnapshot.authority = "dax-legacy"` | Snapshot/reporting marker for runs with no persisted RunState | Logged through `run-gateway`, documented in [authority-model.md](../dax/authority-model.md), tracked in telemetry/counters | Remove once all recoverable runs always create and retain RunState | `packages/dax/src/server`, `packages/dax/src/state` |
| Prompt/config `tools` compatibility | Legacy tool toggles still accepted and translated into permission semantics | Centralized in [legacy-tools.ts](../../packages/dax/src/util/legacy-tools.ts), prompt usage logged, helper covered by [legacy-tools.test.ts](../../packages/dax/src/util/legacy-tools.test.ts) | Remove once agent config, prompt callers, and persisted message/session flows no longer rely on `tools` | `packages/dax/src/config`, `packages/dax/src/session` |

## Recently Removed

| Surface | Removed on | Reason |
| --- | --- | --- |
| Legacy session sidebar route | 2026-04-28 | Dead TUI path, no longer rendered, width reservation and helpers removed |
| Legacy session question route | 2026-04-28 | Dead TUI path, superseded by the live approvals/questions review pane |
| `session.idle` bus event | 2026-04-28 | No remaining subscribers or external references |
| Sidebar-only session display helpers | 2026-04-28 | No runtime callers after sidebar removal |

## Removal Workflow

1. Prove the deprecated path still has or no longer has callers.
2. Centralize conversion or fallback behavior behind one helper if it still must ship.
3. Add or update regression coverage before changing semantics.
4. Add warnings or metrics before removal if external callers may still exist.
5. Remove the path in a dedicated migration change once the removal condition is met.

## Do Not Hand-Wave These

- "We can remove it after release" without a removal condition.
- "It is probably unused" without a caller search or test evidence.
- "Fallback is safe" if the fallback changes authority semantics silently.
