# `dax-cli` Donor Inventory

## Purpose

This document records what `dax-cli` may still contribute to the canonical `dax` repo and what should not be migrated.

`dax-cli` is treated as legacy migration material, not a parallel active product.

## Confirmed Deltas

### Candidate donor areas

- packaging and release-hygiene material that is missing in `dax`
- DAX/Cognito migration notes and compatibility edge cases
- desktop shell packaging ideas
- minimal web/app shell packaging ideas
- any useful permission-layer notes found under the legacy `permission/*` paths

### Legacy or non-donor areas

- `packages/app`
- `packages/desktop`
- Cognito-branded user-facing surfaces
- generated local-state noise
- tracked build artifacts and machine-local files
- duplicate runtime code when the same behavior already exists in `packages/dax`

## File-Level Signals

Observed unique areas in `dax-cli` compared with `dax`:

- `packages/app/*`
- `packages/desktop/*`
- `packages/dax/src/permission/*`
- `packages/dax/src/session/prompt/codex_header.txt`
- migration and implementation docs at the repo root

## Migration Policy

- Migrate only behavior that strengthens the current DAX execution product.
- Reject anything that creates a second product shell inside DAX.
- Reject anything that reintroduces Cognito naming into active surfaces.
- Prefer copying ideas and small isolated features over large subtree imports.

## Current Recommendation

For the first cleanup wave:

- do not migrate app or desktop packaging into DAX
- do not migrate legacy branding or compatibility defaults
- review the legacy permission-layer files and prompt header only if a concrete behavior gap is found
- keep `dax-cli` frozen as a donor/reference branch until a targeted migration list exists
