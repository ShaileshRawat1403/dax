# DAX Repo Boundaries

## Canonical Product Surface

The shipped DAX product lives under `packages/dax`.

This includes:

- CLI entrypoint
- TUI
- local/headless server
- provider integrations
- governance and approvals
- session runtime
- tool registry and execution model

## Quarantined Legacy Material

The repository still contains older scaffold paths at the root:

- `cli/`
- `core/`
- `tui/`
- `script/build.ts`

These paths are not the canonical DAX product and should not be used as the basis for new product work.
They remain only as quarantined legacy material until removal can be done safely.

## Workspace Context

Within the broader `MYAIAGENTS` workspace:

- DAX is the execution product
- Soothsayer is the team/web platform
- `workspace-mcp` is the kernel contract
- DAO is archived/reference-only

## Rules For Future Cleanup

- New product work belongs in `packages/dax`.
- Do not add new features to the root scaffold paths.
- CI should block new additions or edits under the root scaffold paths except explicit removal commits.
- If behavior exists in both the scaffold and `packages/dax`, `packages/dax` wins.
- Any future removal of scaffold paths should preserve only migration notes, not runtime ownership.
