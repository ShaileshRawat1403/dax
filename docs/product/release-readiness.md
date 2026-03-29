# DAX Release Readiness Guide

This guide explains how to validate DAX end to end before a release.

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
bun run --cwd packages/dax src/index.ts --help
bun run release:check
bun run --cwd packages/dax src/index.ts doctor --json
DAX_CONFIG=/Users/Shared/MYAIAGENTS/dax/.dax/dax.jsonc DAX_FORCE_EXIT=1 bun run --cwd packages/dax src/index.ts mcp ping workspace_kernel --json
bun run --cwd packages/dax src/index.ts run --command docs -m google-vertex/gemini-2.5-flash guide Release Readiness
bun run --cwd packages/dax src/index.ts run --command docs -m google-vertex/gemini-2.5-flash qa strict
```

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

### Doctor

- `dax doctor --json` should return structured sections for:
  - auth
  - mcp
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

### Docs Mode

- `run --command docs ...` should return a formatted docs result
- guide mode should emit a usable scaffold
- strict QA should return a structured docs QA result

## Latest Observed Baseline

Observed on March 29, 2026:

- CLI help rendered correctly
- `bun run release:check` passed and wrote `artifacts/audit-result.json`
- `dax doctor --json` returned overall `degraded`
- auth, env, and project reported ready
- MCP reported degraded because the configured local `workspace_kernel` executable path was missing, with an explicit remediation hint

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

## Troubleshooting

- If doctor is blocked on auth:
  - run `dax auth login`
  - run `dax doctor auth --json`
- If MCP is blocked:
  - open the MCP cockpit in the TUI
  - run `dax mcp list`
  - run `dax mcp auth <server>` for remote OAuth servers
- If docs mode fails from CLI:
  - confirm you are using `--command docs`
  - pass docs arguments as plain message tokens, for example `qa strict`

## Release Sign-Off

You are in a reasonable pre-release state when:

1. typecheck passes
2. tests pass
3. repo integrity checks pass
4. CLI help renders correctly
5. MCP health is confirmed
6. `dax approvals` reflects governance state clearly when approvals are pending
7. docs guide generation works
8. docs strict QA works
9. interactive TUI review flows feel coherent
10. any remaining degraded or blocked doctor result is understood and intentional

## Next Actions

1. Keep this guide wired into release verification and CI documentation checks.
2. Capture one visual TUI validation pass with screenshots for the home dashboard, MCP cockpit, approvals, diff review, and docs review.
3. Remove the frozen root legacy paths once references and CI checks show they are no longer needed.
