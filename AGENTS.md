# DAX Repo Agent Rules

Read this file first when working in `/Users/Shailesh/MYAIAGENTS/dax`.

## Local write boundary

- This repository is the only write target for implementation work from this workspace.
- `opencode` under `~/MYAIAGENTS/opencode` is read-only reference material.
- Never apply patches, commits, or generated files in `opencode`.
- Use `opencode` only for comparison and migration context.
- All code, docs, tests, and commits must be made in this `dax` repository unless the user explicitly moves the session into another repo.

## Product identity

- DAX is the core standalone product in this stack.
- DAX is the governed AI and execution authority.
- Picobot and Soothsayer may integrate with DAX, but they must not silently redefine what DAX is.

## Anti-drift rule

- Do not bend DAX's core product direction around companion-repo convenience.
- Change DAX for companion repos only when the change improves DAX as a real standalone product or a clearly intentional external interface.
- Keep the default mental model intact: `DAX = core product`, `Picobot = ingress`, `Soothsayer = operator plane`.

## Working alongside another agent

- More than one AI agent works in this repo. Before any change-bearing work, read [docs/MULTI_AGENT_SOP.md](./docs/MULTI_AGENT_SOP.md).
- Non-negotiables from that file: separate worktrees, one branch has exactly one owner, push before every handoff, and every handoff pins a commit SHA.
- Work is risk-tiered. Release, security, concurrency, state-authority and public-claim changes are Tier 2 and require adversarial cross-validation by the other agent before merge. Everything else is Tier 1 — one agent, no ceremony. When unsure, it is Tier 2.
- The other agent's report of its own work is not evidence. Verify against the tree before building on it.
- Never `push --force`, never `reset --hard` a shared branch, never check out over another agent's uncommitted work.

## Required shared context

- Before major product, architecture, or cross-repo work, read [docs/STACK_OPERATING_MODEL.md](./docs/STACK_OPERATING_MODEL.md).
- If the task involves Picobot or Soothsayer, also consult the copy-ready repo guidance in [docs/repo-agents](./docs/repo-agents).

## Branch hygiene

- Never commit, push, or apply edits directly on `main` or `master`.
- Before making any change-bearing tool call (Edit, Write, file generation, package install), confirm the current branch with `git branch --show-current`.
- If the current branch is `main` or `master`:
  - Stop and create a feature branch first: `git checkout -b <type>/<short-desc>` where `<type>` is `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, or `release`.
  - If the change scope is unclear, ask the user for the branch name before continuing.
- Pull requests are not used in this repo. Push the feature branch when ready; the maintainer merges directly.
- After a feature branch is merged, delete it (`git branch -d` and `git push origin --delete`).
- A committed git pre-commit hook in `.githooks/pre-commit` enforces this for any contributor who runs `git config core.hooksPath .githooks` once.

## Skill output contract

- All findings/audit output from skills follows [docs/skills/OUTPUT_CONTRACT.md](./docs/skills/OUTPUT_CONTRACT.md).
- New skills must reference that file from their own `Output contract` section instead of inlining the rules.
