# Contributing to DAX

## Product Boundary

DAX is the execution control plane for AI-assisted SDLC.

The canonical shipped product lives under `packages/dax`.

Do new product work only in:

- `packages/dax`
- `packages/plugin`
- `packages/util`
- `packages/script`
- `packages/sdk/js`

Root-level `cli/`, `core/`, and `tui/` are frozen legacy paths. Do not add new files there. Do not extend them with new behavior. They remain only until removal work is complete.

Start here:

- `README.md`
- `ARCHITECTURE.md`
- `docs/CONTRIBUTOR_START_HERE.md`
- `docs/REPO_BOUNDARIES.md`
- `docs/DAX_OVERHAUL_PLAN.md`

## Branching and PR Shape

Use one branch per workstream. Keep commits reviewable and Git-friendly.

Preferred branch names:

- `feature/<workstream>`
- `fix/<workstream>`
- `docs/<workstream>`

Preferred change grouping:

1. docs/legal/public surface
2. behavior/runtime changes
3. tests
4. legacy deletions

Do not mix unrelated cleanup, refactors, and behavior changes in one PR if they can be split cleanly.

## Local Development

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run typecheck:dax
bun run test
bun run release:check
```

## Release and Safety Validation

Before opening a release-oriented PR, run:

```bash
bun run release:verify
```

For local release packaging smoke:

```bash
bun run build
```

The release flow expects:

- valid legal and contribution docs
- current README and release docs
- intact release scripts and assets
- no new legacy-root edits

## Plugins, Tools, and Config

Prefer stable extension surfaces over internal patching:

- tools for new execution capabilities
- plugins for integration and policy hooks
- config for agent, provider, and permission behavior

Experimental hooks and bootstrap behavior may change. If you depend on them, document that in your PR and add tests.

## Testing Expectations

At minimum, include the narrowest automated check that proves the change:

- unit tests for pure logic
- integration tests for approvals, config, or CLI/runtime contracts
- release/smoke updates for public-surface or packaging changes

If you change governance, approvals, release validation, or docs integrity, add or update tests in the same PR.
