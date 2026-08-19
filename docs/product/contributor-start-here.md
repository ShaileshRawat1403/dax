---
title: Contributor Start Here
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - contributing
last_reviewed: 2026-08-19
---

# Contributor Start Here

If you are new to DAX, start with these files in order:

1. `README.md`
2. `docs/architecture/ARCHITECTURE.md`
3. `docs/architecture/HOW_DAX_WORKS.md`
4. `docs/product/release-readiness.md`

## Canonical Product Surface

All new product work belongs under `packages/dax`.

The most important entry points are:

- `packages/dax/src/index.ts`: CLI entrypoint
- `packages/dax/src/session/`: runtime and prompt orchestration
- `packages/dax/src/tool/`: tool registry and execution
- `packages/dax/src/governance/`: approvals and permission flow
- `packages/dax/src/provider/`: model/provider routing
- `packages/dax/src/cli/`: user-facing CLI and TUI flows

## Removed Legacy Roots

The root-level `cli/`, `core/`, and `tui/` directories were removed during the
Phase 3 overhaul. All product and runtime code lives under `packages/dax`.

## Best Extension Paths

Prefer these supported customization surfaces:

- custom tool packs
- custom agent/prompt packs
- policy and config packs

Use the public docs before reaching for internal runtime hooks.

## Current Branch Rule

If you are working on the current feature branch, treat the first merge target
as:

- Explore operator flow
- transcript-first TUI/session UX
- product-facing review surfaces

Do not expand the first merge slice with speculative orchestration or framework-only abstractions.
