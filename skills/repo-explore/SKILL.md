---
name: "repo-explore"
description: "Map a repository quickly and produce a grounded reading order, integration inventory, and next-step recommendation."
---

# Repo Explore

Use this skill when the task is to understand a repository before making changes.

## Use when

- the user asks for a codebase walkthrough
- the user wants architecture, entry points, or execution flow
- the user wants to know where to start reading
- the user wants a quick integration inventory

## Workflow

1. Start with top-level inventory.
2. Identify entry points, bootstraps, and orchestration files.
3. Trace the main execution path and key subsystems.
4. Call out integrations, external dependencies, and operational surfaces.
5. Surface unknowns, risks, and missing evidence.
6. End with the best next reading path or implementation entry point.

## Checks

- avoid pretending the whole repo was read if only key files were sampled
- distinguish confirmed flow from inferred flow
- name the files that support major claims
- call out missing tests, docs, or runtime evidence when relevant

## Output contract

Return:

1. `What this repo does`
2. `How execution flows`
3. `Key files and why they matter`
4. `Integrations and external systems`
5. `Unknowns or risks`
6. `Recommended next reading order`

## Tooling

- prefer `rg --files` and `rg` for discovery
- read a small number of high-signal files first
- avoid broad noisy dumps unless the repo is tiny
