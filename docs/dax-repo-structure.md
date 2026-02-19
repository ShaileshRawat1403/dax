# DAX Repo Structure (Safe Rewire Plan)

This repository stays architecture-compatible while moving to DAX-first naming.

## Rule

- Edit only `dax-cli-standalone`.
- Use `~/MYAIAGENTS/opencode` as read-only reference only.

## Current Direction

- Keep runtime architecture stable.
- Add DAX domain modules as canonical entry points.
- Rewire imports gradually from legacy locations to DAX domain locations.

## Status

- Safe rewire phase complete for core TUI/session semantics.
- Shared DAX modules now own:
  - workflow stage labels
  - pane mode/visibility/follow enums
  - intent mode parsing
  - policy profile parsing
  - DAX setting keys used by TUI/session

## DAX Domain Layer

- `packages/dax/src/dax/workflow`
  - Stream/home stages and user-facing stage labels.
- `packages/dax/src/dax/presentation`
  - Pane modes and ELI12-aware labels/titles.
- `packages/dax/src/dax/intent`
  - Intent mode parsing (normal/eli12) and shared helpers.
- `packages/dax/src/dax/brand`
  - Product constants for messaging.
- `packages/dax/src/dax/{approval,memory,execution}`
  - Reserved branded entry points for next rewires.

## Migration Pattern

1. Add helper in `packages/dax/src/dax/**`.
2. Switch one consumer import.
3. Run `bun run typecheck:dax`.
4. Run `bun run test` from `packages/dax`.
5. Repeat.

## Why This Works

- No risky file moves.
- No runtime behavior change by default.
- DAX naming grows at the domain boundary first, then expands inward.
