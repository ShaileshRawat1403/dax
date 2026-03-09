# Workspace Decision Record

## Status

Accepted for the current cleanup wave.

## Decision

The active `MYAIAGENTS` product shape is a three-layer model:

- `workspace-mcp` is the kernel and policy contract.
- `dax` is the local-first governed execution product.
- `soothsayer` is the multi-user platform and orchestration shell.

`dao` is not an active product line. It is retained only as architecture/reference material.

## Ownership

### DAX owns

- CLI and TUI
- Local server and SDK-facing execution API
- Session runtime
- Tool execution and provider/model routing
- RAO and PM behavior at the execution layer

### Soothsayer owns

- Web app
- API
- Worker
- Auth and RBAC
- Analytics
- Team workflows and multi-user operations

### workspace-mcp owns

- Deterministic kernel contract
- Policy layering semantics
- Run and bundle lifecycle contract
- Kernel health, self-check, and tool-call protocol

## Non-Decisions

This cleanup wave does not:

- merge the active products into one repo
- fold `workspace-mcp` into DAX or Soothsayer
- merge DAO into any maintained runtime
- add major new end-user features

## Consequences

- DAX becomes the source of truth for local governed execution.
- Soothsayer remains a platform client/integrator, not the owner of kernel semantics.
- `dax-cli` is legacy migration material, not a parallel product.
- Cross-product terminology should converge on one shared vocabulary for approvals, policy outcomes, and execution events.
