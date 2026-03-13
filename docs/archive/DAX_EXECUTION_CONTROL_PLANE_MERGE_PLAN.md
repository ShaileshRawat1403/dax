# DAX Execution Control Plane Merge Plan

This branch is intentionally too large to merge as one unit.

The merge strategy is:

1. `Explore + operator UX`
2. session/workstation hardening
3. canonical inspect/review command surfaces
4. trust, readiness, and history surfaces
5. orchestration/control-plane follow-up

## Current Merge Target

The first mergeable slice should keep:

- `packages/dax/src/explore/*`
- `packages/dax/src/operators/explore.ts`
- `packages/dax/src/execution/run-graph.ts` only where needed by Explore
- transcript-first TUI/session behavior
- product-facing pane labels:
  - `Plan`
  - `Review`
  - `Changes`
  - `Context`
  - `Docs`
- release-readiness and operator-facing docs that describe implemented behavior

## Explicit Deferrals

The following are intentionally deferred from the first merge slice:

- general-purpose orchestration tool surfaces
- `packages/dax/src/tool/orchestrate.ts`
- `packages/dax/src/orchestration/*`
- control-plane abstractions with no immediate user-facing path
- broad future-state docs that describe systems not yet implemented

## PR Sequence

### PR 1: Explore as the first true operator flow

- ship Explore execution graph, operator routing, and transcript milestones
- keep ELI12-compatible output and calm operator tone
- prove the flow with Explore-specific tests and one real-session validation

### PR 2: Session shell and workstation UX stabilization

- keep transcript-first session rendering
- keep compact header/footer, conditional trace, and contextual review surfaces
- keep only workstation docs that directly reflect implemented behavior

### PR 3: Canonical inspect/review command surfaces

- merge only the command surfaces that are implementation-complete enough to support:
  - `plan`
  - `artifacts`
  - `audit`
  - `verify`
  - `release`
- defer any command whose implementation is still thinner than its design docs suggest

### PR 4: Trust/readiness/history surfaces

- session history
- timeline
- verification
- release-readiness surface

### PR 5: Orchestration/control-plane follow-up

- agent orchestration tool
- orchestration contracts
- broader router/planner/operator abstractions

Do not merge this slice until permissions, transcript behavior, and result aggregation are settled.

## Acceptance Gate For PR 1

- `bun run typecheck:dax`
- `bun run --cwd packages/dax test`
- Explore flow tests pass:
  - `packages/dax/src/explore/repo-explore.test.ts`
  - `packages/dax/src/execution/run-graph.test.ts`
  - `packages/dax/src/session/explore-command.test.ts`
- a real Explore session on this repo shows:
  - what DAX found
  - what DAX is checking
  - what happens next
- raw tool spam is not dominant in the transcript

