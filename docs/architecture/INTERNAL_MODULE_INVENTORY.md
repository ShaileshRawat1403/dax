---
title: Internal Module Inventory
archetype: architecture
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - inventory
  - consolidation
last_reviewed: 2026-08-19
---

# Purpose

This document identifies the canonical, duplicated, partial, and legacy runtime modules in DAX so future work extends the correct surfaces and avoids rework.

> **Status note**: this inventory was updated for the post-overhaul tree. The
> consolidation rows marked `Done` below shipped in commit `f842ff1` ("feat:
> complete DAX overhaul - Session Model V2, Governance consolidation, and
> Workstation UX"). The legacy `core/`, `cli/`, and `tui/` roots no longer exist.

# Classification Rules

- Canonical keep
- Promote
- Merge
- Legacy reference
- Archive/Delete

# Inventory

## Intent

| Path                                   | Status | Classification   | Notes                                    | Action                            |
| -------------------------------------- | ------ | ---------------- | ---------------------------------------- | --------------------------------- |
| `packages/dax/src/intent/interpret.ts` | Active | Canonical Keep   | The primary intent interpretation logic. | Extend with `IntentEnvelope`.     |
| `core/dax/intent.ts`                   | Removed | —               | Deleted in `f842ff1`.                    | Done.                             |

## Planner

| Path                            | Status | Classification   | Notes                                  | Action                                     |
| ------------------------------- | ------ | ---------------- | -------------------------------------- | ------------------------------------------ |
| `packages/dax/src/tool/plan.ts` | Active | Canonical Keep   | Current planner logic, used as a tool. | Evolve into a core graph planning service. |
| `core/session/planner.ts`       | Removed | —               | Deleted in `f842ff1`.                  | Done.                                      |

## Execution

| Path                                    | Status | Classification   | Notes                                 | Action                                                            |
| --------------------------------------- | ------ | ---------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `packages/dax/src/dax/orchestration.ts` | Active | Canonical Keep   | High-level control flow.              | Refactor to consume `IntentEnvelope` and use the Operator Router. |
| `packages/dax/src/session/lifecycle.ts` | Active | Canonical Keep   | Core session and tool execution loop. | Integrate RAO objects (ApprovalRequest, ArtifactRecord, etc.).    |
| `core/dax/execution.ts`                 | Removed | —               | Deleted in `f842ff1`.                 | Done.                                                             |

## Operators

| Path                                    | Status | Classification | Notes                                   | Action                               |
| --------------------------------------- | ------ | -------------- | --------------------------------------- | ------------------------------------ |
| `packages/dax/src/operators/base.ts`    | Active | Canonical Keep | The base class for all operators.       | Solid foundation. No action needed.  |
| `packages/dax/src/operators/router.ts`  | Active | Canonical Keep | Routes intents to the correct operator. | Extend to support new operators.     |
| `packages/dax/src/operators/explore.ts` | Active | Promote        | The most mature, existing operator.     | Use as a template for new operators. |

## Trust / Governance

| Path                                     | Status | Classification   | Notes                                                   | Action                                                            |
| ---------------------------------------- | ------ | ---------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/dax/src/governance/`           | Active | Canonical Keep   | Consolidated governance module.                        | Contains `trust-verification.ts`, `policy-engine.ts`, `audit.ts`, `governance-writer.ts`. |
| `packages/dax/src/sdlc/verify-session.ts` | Active | Canonical Keep   | Repo-SDLC verification (`deriveVerificationPosture`).  | The former `trust/verify-session.ts` home.                        |
| `packages/dax/src/trust/`                | Removed | —               | Consolidated into `governance/` in `f842ff1`.          | Done.                                                             |
| `packages/dax/src/policy/`               | Removed | —               | Consolidated into `governance/` in `f842ff1`.          | Done.                                                             |
| `packages/dax/src/audit/`                | Removed | —               | Consolidated into `governance/` in `f842ff1`.          | Done.                                                             |
| `core/governance/`                       | Removed | —               | Deleted in `f842ff1`.                                  | Done.                                                             |

## Session / Lifecycle

| Path                        | Status | Classification   | Notes                              | Action                              |
| --------------------------- | ------ | ---------------- | ---------------------------------- | ----------------------------------- |
| `packages/dax/src/session/` | Active | Canonical Keep   | The core session management logic. | Continue to build upon this module. |
| `core/session/`             | Removed | —               | Deleted in `f842ff1`.              | Done.                               |

## CLI Surfaces

| Path                        | Status | Classification   | Notes                                         | Action                                                             |
| --------------------------- | ------ | ---------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `packages/dax/src/cli/cmd/` | Future | Canonical Keep   | The designated path for all new CLI commands. | Target for all new CLI work.                                       |
| `cli/`                      | Removed | —               | Deleted in `f842ff1`.                         | Done.                                                              |

## TUI / Presentation

| Path                                 | Status | Classification   | Notes                                               | Action                                                   |
| ------------------------------------ | ------ | ---------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `packages/dax/src/dax/presentation/` | Active | Canonical Keep   | Core workstation and presentation logic.            | Freeze. Only reliability/state-visibility fixes allowed. |
| `packages/dax/src/cli/cmd/tui/`      | Active | Canonical Keep   | The canonical entry point and renderer for the TUI. | Freeze. Only reliability/state-visibility fixes allowed. |
| `tui/`                               | Removed | —               | Deleted in `f842ff1`.                              | Done.                                                    |

# Canonical Future Surface

The active product surface is `packages/dax/src/**`.

# Immediate Promotions

- [ ]
- [ ]
- [ ]

# Legacy Freeze Candidates

- [ ]
- [ ]
- [ ]

# Archive/Delete Candidates

- [x] `packages/dax/src/policy/`
- [x] `tests/run.js`
- [x] `test-stream.ts`
