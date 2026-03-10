# DAX Non-Dev Quickstart

This guide is for people who do not write code daily but want to use DAX safely and effectively.

## What DAX Does In Plain Language

DAX is an AI teammate that can:

- read project files
- suggest changes
- run commands when approved
- explain what it is doing

DAX follows a safety flow:

1. Plan: it structures work before acting.
2. Run: it executes approved work.
3. Override: you approve or deny when checkpoints appear.

## 10-Minute Flow

1. Open DAX with `dax`.
2. Start with planning:
   - `dax plan "Explain this project to me in simple language."`
3. Check the plan preview so you can confirm the interpreted work before execution.
4. Turn on ELI12 mode if needed for simpler responses.
5. Ask for a safe change:
   - `Only suggest, do not apply yet.`
6. Review `diff` pane before approving anything.
7. Run `dax artifacts` to inspect retained outputs after work completes.
8. Run `dax audit` to inspect trust posture before handoff.
9. Run `dax verify <session-id>` when you need a direct judgment about what still blocks a stronger trust posture.
10. Run `dax release check <session-id>` when you need a direct judgment about handoff or shipping readiness.

## Safe Prompts You Can Reuse

- `Summarize this codebase for a product manager.`
- `List risks in the current implementation with severity.`
- `Draft release notes from recent changes.`
- `Create a testing checklist for this feature.`

## What Each Pane Means

- `artifact`: latest generated content
- `diff`: file changes
- `rao`: approvals and policy decisions
- `pm`: long-term project memory
- `audit` (beta): release blockers, warnings, and next actions

## How To Read Audit Output Fast

1. Check `status` first (`pass`, `warn`, `fail`).
2. Check `blockers` count.
3. Read the first 1-3 `next_actions`.

If blockers are present, ask DAX:

- `/audit explain <finding_id>`

## When You Should Not Approve

Do not approve immediately if DAX asks to:

- run destructive shell commands
- modify secrets or auth files
- change many files without clear summary
- skip tests/verification

Ask it to do smaller scoped changes first.

## Screenshots

### 1) ELI12 toggle

![DAX home screen showing ELI12 mode toggle](./images/non-dev-01-eli12-toggle.png)

Capture:
- Home screen
- ELI12 toggle clearly visible

### 2) RAO approval prompt

![DAX RAO approval prompt with approve and deny options](./images/non-dev-02-rao-approval.png)

Capture:
- RAO guardrail response or approve/deny prompt
- Risk/scope context visible

### 3) Diff before approval

![DAX diff pane showing changes before user approval](./images/non-dev-03-diff-before-approval.png)

Capture:
- One file change pending or just before approval
- Added/removed lines readable

## Common Fixes

- Auth confusion:
  - run `dax auth doctor`
- Model not responding:
  - run `dax models` and pick an available model
- Behavior changed after update:
  - check `dax --version` and re-run auth checks

Deep guide: [non-developer-guide.md](non-developer-guide.md)
