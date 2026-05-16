# Claude Code Instructions for DAX

This file is the Claude Code entry point for this repository. The canonical rules live in [AGENTS.md](./AGENTS.md) — read it first. This file calls out the rules that bite Claude most often.

## Hard rules

- **Branch hygiene** — Never edit, commit, or push on `main` or `master`. Before the first change-bearing tool call (Edit, Write, package install, etc.), run `git branch --show-current`. If the result is `main` or `master`, stop and create a feature branch: `git checkout -b <type>/<short-desc>`. Ask the user for the branch name if the scope is unclear. See [AGENTS.md#branch-hygiene](./AGENTS.md#branch-hygiene).
- **No pull requests** — This repo uses direct merges. Push the feature branch; the maintainer merges.
- **No Co-Authored-By trailers** — Do not add `Co-Authored-By: Claude` (or any agent attribution) to commits in this repo.
- **Skill output format** — Any skill that returns findings follows [docs/skills/OUTPUT_CONTRACT.md](./docs/skills/OUTPUT_CONTRACT.md) — grouped tables, impact-ordered, with the five-level severity ladder.

## Working defaults

- Use feature branches with names like `feat/<thing>`, `fix/<thing>`, `chore/<thing>`, `docs/<thing>`, `release/<version>`.
- Run `bun run typecheck` + `bun run test` before pushing.
- For release work, also run `bun run release:verify` and `bun run eval:smoke`.
- Rust changes also need `bun run rust:verify`.

## Where things live

| Surface | Path |
|---|---|
| Canonical agent rules | [AGENTS.md](./AGENTS.md) |
| Skill output contract | [docs/skills/OUTPUT_CONTRACT.md](./docs/skills/OUTPUT_CONTRACT.md) |
| Skills (committed) | [skills/](./skills/) |
| Release readiness playbook | [docs/product/release-readiness.md](./docs/product/release-readiness.md) |
| Stack operating model | [docs/STACK_OPERATING_MODEL.md](./docs/STACK_OPERATING_MODEL.md) |
| Git pre-commit hook | [.githooks/pre-commit](./.githooks/pre-commit) (opt-in via `git config core.hooksPath .githooks`) |

## On the local Claude Code hook

`.claude/settings.local.json` carries a personal `PreToolUse` hook that blocks `Edit`/`Write` on `main`/`master`. The settings file is gitignored, so the hook only protects this machine. The committed `.githooks/pre-commit` is the cross-contributor backstop.
