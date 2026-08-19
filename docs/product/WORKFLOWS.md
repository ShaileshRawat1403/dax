---
title: DAX Official Workflows
archetype: product
status: superseded
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - workflows
---

# DAX Official Workflows

> **Status note**: The v0.2 milestone framing below predates the shipped
> workflow layer. The real builtin workflows are `repo-health`, `explore-repo`,
> and `release-readiness` (packages/dax/src/workflows/builtin-workflows.ts:3),
> run via `dax workflow run`. The `repo-audit` and `architecture-map` workflows
> below were never built (their design docs are marked superseded). Retained as
> design history.

This document lists the officially supported, end-to-end workflows available in DAX. Each workflow is a declarative execution graph that performs a specific, high-value engineering task.

## v0.2 Milestone Workflows

The following workflows are targeted for the v0.2 release. They are designed to exercise the full DAX execution plane, from intent interpretation to artifact generation and policy evaluation.

### 1. `repo-audit`

- **Goal**: Performs a comprehensive health and policy audit of a repository.
- **Output**: A detailed audit report with a maintainability score, complexity hotspots, and policy violations.
- **Design Doc**: [Workflow Design: repo-audit](../features/WORKFLOW_REPO_AUDIT.md)

### 2. `architecture-map`

- **Goal**: Analyzes a repository to produce a high-level, human-readable architecture map.
- **Output**: A markdown document summarizing the application's architecture, components, and boundaries.
- **Design Doc**: [Workflow Design: architecture-map](../features/WORKFLOW_ARCHITECTURE_MAP.md)

### 3. `release-readiness`

- **Goal**: Acts as a final gatekeeper to verify if the codebase is ready for a production release.
- **Output**: A "Go / No-Go" recommendation with a list of blockers, based on test coverage, documentation, and other policies.
- **Design Doc**: [Workflow Design: release-readiness](../features/WORKFLOW_RELEASE_READINESS.md)
