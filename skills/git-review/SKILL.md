---
name: "git-review"
description: "Review local git changes for correctness, risk, and release impact with findings-first output."
---

# Git Review

Use this skill when the task is to review a diff, commit stack, or local worktree.

## Use when

- the user asks for a review
- a branch is about to be merged or released
- local changes need a correctness and risk pass
- the task is to identify regressions and missing tests

## Workflow

1. Gather git status and diff context.
2. Identify the files with behavioral impact.
3. Review for bugs, regressions, and missing test coverage.
4. Check whether docs, release surfaces, or operator UX need matching updates.
5. Report findings first, ordered by severity.

## Output contract

Return:

1. `Findings`
2. `Open questions or assumptions`
3. `Residual risk`

## Guardrails

- prefer concrete findings over broad praise
- cite file paths for issues
- mention when no findings were discovered
