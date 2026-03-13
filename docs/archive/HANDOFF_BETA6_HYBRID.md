# DAX Beta.6 Hybrid Handoff

## Intent

This branch is the deliberate "best old DAX plus selective newer features" path.

The goal is not to revive the later workstation rewrite. The goal is to ship the
old beta.6 shell with the best later features blended in only where they add
clear value.

Primary rule:

- keep the beta.6 layout and shell
- reuse later code selectively
- do not reintroduce drawer/workstation/right-rail architecture churn
- blend features through modes, commands, dialogs, and session context

## Branches To Keep

- `main`
- `inspect/beta6-ui`

Everything else was temporary inspection or backup work.

## Working Baseline

Current working branch:

- `inspect/beta6-ui`

Base commit lineage:

- old stable shell from `dda6eb4` (`beta.6`)

Donor line used for selective reuse:

- `main` / `release/dax-beta` / `9c4d609`

## What Has Already Been Blended

### Core shell direction

- Old beta.6 split-pane/session shell preserved.
- No later drawer-first workstation rewrite.

### Stability and presentation

- Home orphan-text crash fixed.
- Centered pill toasts/welcome behavior restored.
- Session pane ratio improved to give the stream more room.

### PM

- PM upgraded from placeholder to a functional pane:
  - `/pm note`
  - `/pm list`
  - `/pm rules`
- PM parsing helpers added in:
  - `packages/dax/src/pm/format.ts`

### Review surfaces

- Approvals review dialog added.
- Diff review dialog added.
- Timeline dialog upgraded.
- Status dialog upgraded with more actionable MCP guidance.

### Session context

- Left sidebar "Session Context" upgraded to show:
  - current mode
  - turn count
  - pending approvals/questions
  - open todos
  - changed files
  - token/context usage
  - cost
  - latest audit status

### Mode direction

The top strip now moves toward the requested workflow-mode model:

- `plan`
- `build`
- `explore`
- `docs`
- `audit`

Important distinction:

- `explore` should behave as a true mode via the existing agent path
- `audit` should behave as a workflow mode/command, not a new side-pane surface

### Startup default

- Home / fresh TUI startup now defaults to `plan`, not `build`

## Files Most Relevant To Resume

### Mode and startup

- `packages/dax/src/cli/cmd/tui/app.tsx`
- `packages/dax/src/cli/cmd/tui/component/dialog-agent.tsx`
- `packages/dax/src/dax/settings/index.ts`

### Session behavior

- `packages/dax/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/dax/src/cli/cmd/tui/routes/session/footer.tsx`
- `packages/dax/src/cli/cmd/tui/routes/session/sidebar.tsx`
- `packages/dax/src/cli/cmd/tui/component/prompt/index.tsx`

### Added donor features

- `packages/dax/src/cli/cmd/tui/component/dialog-approvals.tsx`
- `packages/dax/src/cli/cmd/tui/component/dialog-diff.tsx`
- `packages/dax/src/cli/cmd/tui/component/dialog-status.tsx`
- `packages/dax/src/cli/cmd/tui/routes/session/dialog-timeline.tsx`
- `packages/dax/src/pm/format.ts`
- `packages/dax/src/dax/status.ts`

### Home / onboarding

- `packages/dax/src/cli/cmd/tui/routes/home.tsx`
- `packages/dax/src/cli/cmd/tui/ui/toast.tsx`
- `packages/dax/src/cli/cmd/tui/ui/dialog-help.tsx`

## What To Avoid

Do not do these unless explicitly changing product direction:

- do not reapply the later workstation shell rewrite
- do not bring back context drawer / truth-rail architecture
- do not turn audit/explore into new content panes
- do not expand the session shell into more competing surfaces
- do not replace the old beta.6 shell with `9c4d609` session architecture

## Correct Product Direction From This Work

Use the old shell, then blend newer value in these layers:

- modes
- commands
- dialogs
- session context
- deterministic execution plumbing

Not these layers:

- new layout systems
- new shell architecture
- new view hierarchies

## Known Good Direction

Best interpretation of the user's intent:

- preserve the old DAX feel
- make it robust
- surface later useful features
- keep execution deterministic
- make `plan/build/explore/docs/audit` feel like first-class modes

## Known Recent Fixes

- Session crash from `Cannot access 'revert' before initialization` was fixed by
  moving revert/diff memos above command registration in
  `packages/dax/src/cli/cmd/tui/routes/session/index.tsx`.
- Sidebar audit parsing needed typed narrowing for text parts.
- Mode picker was relabeled from "agent" to "mode".

## Immediate Next Steps

1. Verify the current mode strip UX in-session:
   - `plan`
   - `build`
   - `explore`
   - `docs`
   - `audit`

2. Make mode switching feel consistent:
   - selecting `explore` should use the explore agent cleanly
   - selecting `docs` should use the docs agent cleanly
   - selecting `audit` should prime audit workflow cleanly

3. Keep improving deterministic execution:
   - better workflow handoff between `plan` and `build`
   - clearer audit entry/results
   - stronger Explore output behavior without layout changes

4. Only after that, continue selective donor reuse if needed:
   - trust/release helpers
   - deterministic status improvements
   - additional small command surfaces

## Quick Resume Commands

Check branch:

```bash
git branch --show-current
```

Run typecheck:

```bash
bun run typecheck:dax
```

Launch TUI:

```bash
bun run dev
```

## Summary

This branch is the curated DAX recovery path:

- old shell from beta.6
- newer useful features
- no workstation overreach
- mode-first blending
- deterministic execution as the next priority
