# DAX Release Readiness Guide

This guide explains how to validate DAX end to end before a release.

## Purpose

Use this checklist when you want confidence that the shipped DAX product still works as a complete experience:

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

### Doctor

- `dax doctor --json` should return structured sections for:
  - auth
  - mcp
  - env
  - project
- non-zero exit is acceptable when a real blocker exists
- every blocked or failed section should include a concrete next action

### MCP

- `workspace_kernel` should report `connected`
- latency should be low enough to feel interactive
- tool inventory should be returned successfully

### Docs Mode

- `run --command docs ...` should return a formatted docs result
- guide mode should emit a usable scaffold
- strict QA should return a structured docs QA result

## Latest Observed Baseline

Observed on March 9, 2026:

- CLI help rendered correctly
- MCP ping passed against `workspace_kernel`
- docs guide generation passed
- docs strict QA passed
- `dax doctor --json` returned overall `blocked` because Google OAuth needs attention, while Vertex auth, MCP, env, and project checks were healthy

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
4. Make one low-risk edit and confirm diff review is reachable from the session bar, action strip, and command palette.
5. If MCP is configured, open `Inspect MCP` from the session shell and confirm the cockpit is usable.
6. Open the docs workflow from the session review surface and confirm docs QA or guide review is legible in-session.
7. Navigate a longer transcript and confirm:
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
3. CLI help renders correctly
4. MCP health is confirmed
5. docs guide generation works
6. docs strict QA works
7. interactive TUI review flows feel coherent
8. any remaining blocked doctor result is understood and intentional

## Next Actions

1. Add this guide to the prerelease flow and CI documentation checks.
2. Capture one visual TUI validation pass with screenshots for the home dashboard, MCP cockpit, approvals, diff review, and docs review.
