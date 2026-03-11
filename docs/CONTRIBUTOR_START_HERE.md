# Contributor Start Here

If you are new to DAX, start with these files in order:

1. `README.md`
2. `ARCHITECTURE.md`
3. `docs/REPO_BOUNDARIES.md`
4. `docs/DAX_EXECUTION_CONTROL_PLANE_MERGE_PLAN.md`

## Canonical Product Surface

All new product work belongs under `packages/dax`.

The most important entry points are:

- `packages/dax/src/index.ts`: CLI entrypoint
- `packages/dax/src/session/`: runtime and prompt orchestration
- `packages/dax/src/tool/`: tool registry and execution
- `packages/dax/src/governance/`: approvals and permission flow
- `packages/dax/src/provider/`: model/provider routing
- `packages/dax/src/cli/`: user-facing CLI and TUI flows

## Frozen Legacy Paths

These root-level paths are frozen and pending removal:

- `cli/`
- `core/`
- `tui/`

Do not add new files or behavior there.

## Best Extension Paths

Prefer these supported customization surfaces:

- custom tool packs
- custom agent/prompt packs
- policy and config packs

Use the public docs before reaching for internal runtime hooks.

## Current Branch Rule

If you are working on `feature/dax-execution-control-plane`, treat the first merge target as:

- Explore operator flow
- transcript-first TUI/session UX
- product-facing review surfaces

Do not expand the first merge slice with speculative orchestration or framework-only abstractions.
