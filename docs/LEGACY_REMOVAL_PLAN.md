# Legacy Removal Plan

## Frozen Paths

These root paths are frozen legacy material:

- `cli/`
- `core/`
- `tui/`

No new features should land there.

## Why They Still Exist

- historical scaffolding remains tracked in git
- they preserve migration context while the canonical surface hardens
- some docs still mention them indirectly
- they may still contain reusable CLI, TUI, and core behavior that should be assessed before deletion

## Removal Order

1. Assess donor value and identify what should be reused or refactored into `packages/dax`.
2. Remove dead documentation references to legacy roots.
3. Confirm no canonical runtime path imports or depends on root legacy code.
4. Delete only clearly redundant legacy code in small reviewable commits.
5. Retain only migration notes in docs where needed.

## Current Checks

- CI blocks new additions or edits under root legacy paths.
- Public docs point contributors to `packages/dax`.

## Success Condition

The legacy cleanup effort is complete when:

- reusable legacy behavior has either been migrated or intentionally rejected
- only redundant legacy code has been deleted
- a contributor can identify the shipped product surface without seeing confusing duplicate runtime trees
