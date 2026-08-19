---
title: Soothsayer Repo Agent Rules
archetype: repo-agents
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - repo-agents
  - soothsayer
---

# Soothsayer Repo Agent Rules

Read this file first when working in the Soothsayer repo.

## Identity

- Soothsayer is the operator cockpit and control plane for DAX runs.
- Soothsayer is not the owner of execution truth.
- Soothsayer should help humans observe, govern, approve, recover, and understand DAX work.

## Product boundaries

- DAX should remain the authority for governed runs, approvals, recovery, and execution truth.
- Soothsayer chat may use direct providers for ordinary inline assistance.
- DAX mode is the explicit switch into governed coding execution.

## Anti-drift rules

- Do not let direct provider chat silently perform governed coding actions.
- Do not duplicate DAX lifecycle truth locally and then treat the copy as canonical.
- Do not bundle destructive maintenance tasks into feature releases just to make release automation look cleaner.

## Cross-repo context

- Read `docs/STACK_OPERATING_MODEL.md` from the DAX repo.
- Remember the stack model:
  - `DAX = standalone governed coding runtime`
  - `Picobot = ingress`
  - `Soothsayer = operator plane`

## Release discipline

- Keep product/runtime changes separate from destructive schema cleanup when possible.
- Use explicit maintenance tasks for legacy database retirement and similar cleanup.
