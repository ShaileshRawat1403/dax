---
title: DAX Release Readiness Guide
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - release
---

# DAX Release Readiness Guide

This guide explains how to validate DAX end to end before a release.

Release truth comes first:

- `main` is the next development line
- a release tag is the shipped truth
- the top tagged `CHANGELOG` entry is the exact shipped delta
- post-release commits must land under `## [Unreleased]`

## Purpose

Use this checklist when you want confidence that the shipped DAX product still works as a complete experience:

- legal and public docs are production-ready
- canonical repo boundaries are intact
- CLI help and command grouping render correctly
- readiness diagnostics report actionable state
- MCP integration is healthy
- docs workflows still generate and validate documentation
- the repo contains a current release-readiness artifact
- the flagship TUI review surfaces still feel coherent in a live session
- active deprecated compatibility paths are known and intentionally tracked

## Recommended Scope

Run this guide before:

- a beta or prerelease cut
- packaging changes
- MCP integration changes
- major TUI or CLI UX changes
- documentation or onboarding changes

## Core Commands

Run these from the repository root.

```bash
# Choose any configured provider/model lane that reports ready. This is an
# example only; do not assume a Vertex lane is configured.
export DAX_RELEASE_MODEL="openai/gpt-5.5"

bun run --cwd packages/dax src/index.ts --help
bun run release:check
bun run --cwd packages/dax src/index.ts doctor auth --json
bun run --cwd packages/dax src/index.ts doctor auth "$DAX_RELEASE_MODEL" --json
bun run --cwd packages/dax src/index.ts doctor --json
bun run --cwd packages/dax src/index.ts doctor lsp --json
bun run --cwd packages/dax src/index.ts debug lsp status
bun run --cwd packages/dax src/index.ts run --command docs -m "$DAX_RELEASE_MODEL" guide Release Readiness
bun run --cwd packages/dax src/index.ts run --command docs -m "$DAX_RELEASE_MODEL" qa strict
```

Use a lane that the targeted `doctor auth` command reports as ready. Provider-
specific prerequisites, such as a Google Cloud project for Vertex, are not
assumed by this release guide.

## Expected Results

### CLI Help

- top-level help should render grouped guidance:
  - start and work
  - review and inspect
  - diagnose and configure
  - automate and export

### Repo Integrity

- `bun run release:check` should fail when legal docs are placeholders
- `bun run release:check` should fail when markdown links or referenced assets are missing
- `bun run release:check` should fail when new edits land under root legacy paths in CI
- `bun run release:check` should fail when `CHANGELOG.md` has no `Unreleased` section
- `bun run release:check` should fail when package version and latest tagged changelog entry drift
- `bun run release:check` should write both `artifacts/audit-result.json` and `artifacts/doctor-auth.json`
- `bun run release:check` should write `artifacts/release-provenance.json`
- `bun run release:check` should write `artifacts/determinism-proof.json` — a machine-readable receipt that the Rust proof surfaces (replay, policy, audit) produced consistent output against the release snapshot; this artifact records that the deterministic contract held, not that the model was correct
- in release mode, `bun run release:check` should fail when `HEAD` is untagged, mismatched, or dirty

### Doctor

- `dax doctor --json` should return structured sections for:
  - auth
  - mcp
  - lsp
  - env
  - project
- report readiness as `ready`, `degraded`, or `blocked`
- non-zero exit is acceptable only when a real blocker exists
- every degraded or blocked section should include a concrete next action

### MCP

- a configured MCP server should either:
  - report `connected`, or
  - degrade with a concrete remediation path if it is optional but broken
- latency should be low enough to feel interactive when connected
- tool inventory should be returned successfully when the server is healthy

### LSP

- `debug lsp status` should return:
  - the enabled server ids DAX sees for this repo
  - the currently connected LSP clients, if any
- `doctor lsp --json` should summarize whether DAX sees LSP as configured, idle, or degraded
- zero connected clients is acceptable before file-driven activation

### Docs Mode

- `run --command docs ...` should return a formatted docs result
- guide mode should emit a usable scaffold
- strict QA should return a structured docs QA result

## Latest Observed Baseline

Observed on March 30, 2026:

- CLI help rendered correctly
- `bun run release:check` passed and wrote `artifacts/audit-result.json`
- `bun run --cwd packages/dax src/index.ts doctor auth --json` returned structured provider readiness details
- `dax doctor --json` returned overall `ready`
- auth, env, and project reported ready
- `dax doctor lsp --json` returned an idle-but-ready LSP section with enabled server visibility
- repo-local MCP stayed intentionally disabled by default, so first-run readiness remained clean

## Known UX Notes

- `dax docs ...` is the canonical CLI path for docs workflows
- `dax run "/docs ..."` should route into the built-in docs flow for compatibility

## Interactive TUI Checklist

Validate these in one real session before release:

1. Open DAX and confirm the home screen shows readiness clearly.
2. Start a safe read-only task and verify the session shell exposes:
   - `What to do now`
   - `Move through this session`
   - `Review and inspect`
3. Trigger a blocked approval or question and confirm the action strip points to the review path.
4. Run `dax approvals` in a second terminal and confirm pending approvals are visible as operator objects.
5. Make one low-risk edit and confirm diff review is reachable from the session bar, action strip, and command palette.
6. If MCP is configured, open `Inspect MCP` from the session shell and confirm the cockpit is usable.
7. Open the docs workflow from the session review surface and confirm docs QA or guide review is legible in-session.
8. Navigate a longer transcript and confirm:
   - position indicator updates
   - `jump live` works
   - transcript jump controls remain understandable on your terminal width
9. Trigger a free-form question and confirm the review pane accepts and submits a typed answer.
10. Use the operator commands and confirm:
   - `export` writes a transcript with markdown tables
   - `fork` creates a follow-on session
   - `help` opens the in-session help surface
11. Confirm sub-second tool calls render as `ms` instead of `0s`.

## Compatibility Review

Before release, review the active compatibility inventory in [deprecation-tracker.md](./deprecation-tracker.md).

Sign-off expectations:

- every remaining deprecated path has a clear reason to exist
- every remaining deprecated path is centralized or otherwise bounded
- high-risk deprecated paths emit warnings or metrics instead of silently changing behavior
- any path removed in the release was proven dead, not merely old

## Troubleshooting

- If doctor is blocked on auth:
  - run `dax auth login`
  - run `dax doctor auth --json`
- If MCP is blocked:
  - open the MCP cockpit in the TUI
  - run `dax mcp list`
  - run `dax mcp auth <server>` for remote OAuth servers
  - enable the local `workspace_kernel` only after its executable is installed
- If docs mode fails from CLI:
  - confirm you are using `--command docs`
  - pass docs arguments as plain message tokens, for example `qa strict`

## Release Sign-Off

You are in a reasonable pre-release state when:

1. typecheck passes
2. tests pass (including `cargo test --workspace` for Rust proof surfaces)
3. repo integrity checks pass
4. CLI help renders correctly
5. MCP health is confirmed
6. `dax approvals` reflects governance state clearly when approvals are pending
7. docs guide generation works
8. docs strict QA works
9. interactive TUI review flows feel coherent
10. any remaining degraded or blocked doctor result is understood and intentional
11. `artifacts/determinism-proof.json` is present and records passing Rust proof surface checks
12. active compatibility paths have been reviewed against [deprecation-tracker.md](./deprecation-tracker.md)

Maintainer anti-drift blockers:

- "docs updated later"
- "we'll fix provider wording after release"
- "tag first, sort truth later"

Release-facing docs must describe only shipped behavior and should use the same core framing:

- governed execution
- runtime contract
- evidence-based completion
- operator workstation
- deterministic runtime contract around stochastic model execution

Release provenance means the machine-readable receipt for a cut proves:

- git commit, git tag, package version, and latest tagged changelog version all agree
- release artifacts can be attributed to that same version
- release mode was not run from a dirty working tree

## Next Actions

1. Keep this guide wired into release verification and CI documentation checks.
2. Capture one visual TUI validation pass with screenshots for the home dashboard, MCP cockpit, approvals, diff review, and docs review.
3. Keep [deprecation-tracker.md](./deprecation-tracker.md) current as compatibility paths are hardened or removed.
4. Remove the frozen root legacy paths once references and CI checks show they are no longer needed.
