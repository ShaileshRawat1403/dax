# Workspace Consolidation Plan

## Scope

This document maps the current `MYAIAGENTS` workspace and recommends how to consolidate the scattered projects into a smaller, coherent product set.

Projects reviewed:

- `dao`
- `dax`
- `dax-cli`
- `soothsayer`

## Current State

### `dax`

Role:
- Current governed AI CLI/TUI product.

Strengths:
- Best-defined product direction around RAO, PM, provider support, TUI, server, and session model.
- Active recent work.
- Simpler product boundary than `dax-cli`.

Weaknesses:
- Dirty repo.
- Docs and metadata drift.
- Contains some duplicate scaffold code at the repo root.

Recommendation:
- Keep as the primary foundation for the consolidated agent product.

### `dax-cli`

Role:
- Transitional DAX branch with older `Cognito` history and extra shells.

Strengths:
- Contains migration knowledge from `Cognito` to `DAX`.
- Includes app and desktop packaging shells not present in `dax`.
- Likely source of useful release and compatibility code.

Weaknesses:
- Product identity is mixed: `DAX`, `Cognito`, app shell, desktop shell.
- Carries compatibility baggage and stale naming.
- Large amount of generated and local-state noise.
- Appears to be an alternate branch of the same product, not a separate product.

Recommendation:
- Do not keep as an independent product.
- Mine it for missing features, migration notes, desktop/web shell pieces, and then retire/archive it.

### `dao`

Role:
- Rust orchestration engine and CLI.

Strengths:
- Clear engine-oriented architecture.
- Deterministic workflow model.
- Good candidate for a reusable policy/orchestration kernel.

Weaknesses:
- Smaller ecosystem surface than DAX.
- Separate runtime stack increases maintenance cost.
- Overlaps conceptually with DAX governance/orchestration.

Recommendation:
- Keep only if you want a Rust execution kernel or embedded orchestrator.
- Otherwise archive as an R&D branch and extract concepts, not the whole product.

### `soothsayer`

Role:
- Full-stack AI workspace platform.

Strengths:
- Web app, API, worker, auth, RBAC, analytics, workflows.
- Strong fit for multi-user/team use cases.
- Complements DAX more than it overlaps.

Weaknesses:
- Much heavier infrastructure footprint.
- Different product shape from terminal-first DAX.
- Bigger operational surface: DB, Redis, worker, API, frontend.

Recommendation:
- Keep as a separate platform product, or turn it into the team/multi-user control plane that consumes DAX capabilities.

## Recommended Consolidated Product Set

### Option A: Two-product strategy

This is the recommended path.

Product 1:
- `DAX`
- Terminal-first governed AI execution product.
- Owns CLI, TUI, session runtime, RAO, PM, provider integrations, MCP/ACP, local/server mode.

Product 2:
- `Soothsayer`
- Team workspace and orchestration platform.
- Owns web app, API, auth, RBAC, analytics, long-running workflows, multi-user operations.
- Uses DAX as an execution engine or integrates DAX concepts selectively.

Archive:
- `dax-cli`
- `dao` unless you explicitly want a Rust engine line.

### Option B: One-product strategy

Only choose this if you want one flagship platform.

Single product:
- `Soothsayer` as the main platform shell.
- `DAX` becomes the local/terminal execution engine inside that platform.

Risks:
- Higher integration cost.
- Much slower cleanup.
- Easier to create a bloated, confused product if boundaries are not enforced.

## Recommended Boundary Model

### Keep in `DAX`

- Local-first CLI/TUI
- Session runtime
- Tool execution
- Provider/model routing
- RAO governance
- PM local memory
- Server mode for local or remote attachment
- Plugin and MCP/ACP integrations

### Keep in `Soothsayer`

- Multi-user authentication and authorization
- Team workspaces
- Workflow dashboard/editor
- Background job processing
- Analytics and audit dashboards
- Browser-first UI
- Org-level integrations and operations

### Do not duplicate in both

- Provider abstraction
- Tool contract schemas
- Policy vocabulary
- Session/event model names
- Approval semantics
- Docs for the core mental model

## Migration Sources

### Pull from `dax-cli` into `dax`

- Anything still missing around:
  - desktop shell
  - web shell
  - migration compatibility notes
  - release checks and packaging behavior
  - Cognito-to-DAX rename edge cases

Do not pull:
- legacy naming
- root app shells unless they serve the current DAX product direction
- local state files, generated artifacts, and historical baggage

### Pull from `dao` into `dax` or `soothsayer`

- Architecture ideas only:
  - deterministic reducer patterns
  - event-sourced workflow logic
  - policy simulation
  - explicit workflow state transitions

Do not merge the repo wholesale unless you commit to maintaining a Rust core.

## Immediate Cleanup Priorities

### Phase 1: Repo hygiene

1. Clean and stabilize `dax` as the primary execution product.
2. Remove or quarantine duplicate scaffold code inside `dax`.
3. Fix DAX docs, links, version metadata, and test gaps.
4. Inventory which `dax-cli` features do not exist in `dax`.

### Phase 2: Product boundary cleanup

1. Mark `dax-cli` as migration-source or archive candidate.
2. Strip generated artifacts, local DB files, and accidental check-ins from `dax-cli`.
3. Decide whether `dao` is strategic or archival.
4. Define the DAX-to-Soothsayer integration contract.

### Phase 3: Consolidation

1. Move selected missing capabilities from `dax-cli` into `dax`.
2. Standardize naming across DAX and Soothsayer:
   - RAO
   - PM
   - approval states
   - tool and event terminology
3. Expose DAX through a stable API or SDK boundary for Soothsayer.

## Concrete Recommendation

If the goal is to reduce chaos quickly:

1. Treat `dax` as the canonical agent/execution product.
2. Treat `dax-cli` as a feature donor, then archive it.
3. Keep `soothsayer` as a separate platform product, not a fork of DAX.
4. Keep `dao` only if you want a Rust kernel roadmap; otherwise archive it and preserve ideas in docs.

## Suggested End State

### Product A: `dax`

Tagline:
- Governed AI execution for developers and operators.

Interfaces:
- CLI
- TUI
- local server/API
- plugin/MCP/ACP

### Product B: `soothsayer`

Tagline:
- Team AI workspace for planning, execution, review, and automation.

Interfaces:
- Web app
- API
- worker
- DAX-backed execution lane

## Next Execution Tasks

Recommended order:

1. Finish cleaning `dax`.
2. Diff `dax-cli/packages/dax` against `dax/packages/dax` and produce a feature gap list.
3. Remove obvious junk from `dax-cli` and mark it as legacy/migration.
4. Define an integration contract between `soothsayer` and `dax`.
5. Decide whether `dao` is archived or retained as an engine experiment.
