---
title: Internal Module Inventory
archetype: architecture
status: draft
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags: [dax, architecture, inventory, consolidation]
last_reviewed: 2026-03-13
---

# Purpose

This document identifies the canonical, duplicated, partial, and legacy runtime modules in DAX so future work extends the correct surfaces and avoids rework.

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
| `core/dax/intent.ts`                   | Legacy | Legacy Reference | Older, duplicated implementation.        | Archive/Delete after full review. |

## Planner

| Path                            | Status | Classification   | Notes                                  | Action                                     |
| ------------------------------- | ------ | ---------------- | -------------------------------------- | ------------------------------------------ |
| `packages/dax/src/tool/plan.ts` | Active | Canonical Keep   | Current planner logic, used as a tool. | Evolve into a core graph planning service. |
| `core/session/planner.ts`       | Legacy | Legacy Reference | Older, duplicated implementation.      | Archive/Delete after full review.          |

## Execution

| Path                                    | Status | Classification   | Notes                                 | Action                                                            |
| --------------------------------------- | ------ | ---------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `packages/dax/src/dax/orchestration.ts` | Active | Canonical Keep   | High-level control flow.              | Refactor to consume `IntentEnvelope` and use the Operator Router. |
| `packages/dax/src/session/lifecycle.ts` | Active | Canonical Keep   | Core session and tool execution loop. | Integrate RAO objects (ApprovalRequest, ArtifactRecord, etc.).    |
| `core/dax/execution.ts`                 | Legacy | Legacy Reference | Older, duplicated implementation.     | Archive/Delete after full review.                                 |

## Operators

| Path                                    | Status | Classification | Notes                                   | Action                               |
| --------------------------------------- | ------ | -------------- | --------------------------------------- | ------------------------------------ |
| `packages/dax/src/operators/base.ts`    | Active | Canonical Keep | The base class for all operators.       | Solid foundation. No action needed.  |
| `packages/dax/src/operators/router.ts`  | Active | Canonical Keep | Routes intents to the correct operator. | Extend to support new operators.     |
| `packages/dax/src/operators/explore.ts` | Active | Promote        | The most mature, existing operator.     | Use as a template for new operators. |

## Trust / Governance

| Path                       | Status | Classification   | Notes                                                   | Action                                                        |
| -------------------------- | ------ | ---------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/dax/src/trust/`  | Active | Merge            | Contains `write-governance.ts` and `verify-session.ts`. | Consolidate into a new `packages/dax/src/governance/` module. |
| `packages/dax/src/policy/` | Active | Merge            | Contains the policy engine.                             | Consolidate into `packages/dax/src/governance/`.              |
| `packages/dax/src/audit/`  | Active | Merge            | Contains audit logic.                                   | Consolidate into `packages/dax/src/governance/`.              |
| `core/governance/`         | Legacy | Legacy Reference | Older, duplicated implementation.                       | Archive/Delete after merging is complete.                     |

## Session / Lifecycle

| Path                        | Status | Classification   | Notes                              | Action                              |
| --------------------------- | ------ | ---------------- | ---------------------------------- | ----------------------------------- |
| `packages/dax/src/session/` | Active | Canonical Keep   | The core session management logic. | Continue to build upon this module. |
| `core/session/`             | Legacy | Legacy Reference | Older, duplicated implementation.  | Archive/Delete after full review.   |

## CLI Surfaces

| Path                        | Status | Classification   | Notes                                         | Action                                                             |
| --------------------------- | ------ | ---------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `packages/dax/src/cli/cmd/` | Future | Canonical Keep   | The designated path for all new CLI commands. | Target for all new CLI work.                                       |
| `cli/`                      | Legacy | Legacy Reference | The old set of CLI commands.                  | Freeze. Wire to new operators and skills, then plan for migration. |

## TUI / Presentation

| Path                                 | Status | Classification   | Notes                                               | Action                                                   |
| ------------------------------------ | ------ | ---------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `packages/dax/src/dax/presentation/` | Active | Canonical Keep   | Core workstation and presentation logic.            | Freeze. Only reliability/state-visibility fixes allowed. |
| `packages/dax/src/cli/cmd/tui/`      | Active | Canonical Keep   | The canonical entry point and renderer for the TUI. | Freeze. Only reliability/state-visibility fixes allowed. |
| `tui/`                               | Legacy | Legacy Reference | Older, separate TUI implementation.                 | Archive/Delete.                                          |

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

- [ ]
- [ ]
- [ ]
