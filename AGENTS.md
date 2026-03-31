# DAX Repo Agent Rules

Read this file first when working in `/Users/Shared/MYAIAGENTS/dax`.

## Local write boundary

- This repository is the only write target for implementation work from this workspace.
- `opencode` under `~/MYAIAGENTS/opencode` is read-only reference material.
- Never apply patches, commits, or generated files in `opencode`.
- Use `opencode` only for comparison and migration context.
- All code, docs, tests, and commits must be made in `dax-cli-standalone` unless the user explicitly moves the session into another repo.

## Product identity

- DAX is the core standalone product in this stack.
- DAX is the governed AI and execution authority.
- Picobot and Soothsayer may integrate with DAX, but they must not silently redefine what DAX is.

## Anti-drift rule

- Do not bend DAX's core product direction around companion-repo convenience.
- Change DAX for companion repos only when the change improves DAX as a real standalone product or a clearly intentional external interface.
- Keep the default mental model intact: `DAX = core product`, `Picobot = ingress`, `Soothsayer = operator plane`.

## Required shared context

- Before major product, architecture, or cross-repo work, read [docs/STACK_OPERATING_MODEL.md](./docs/STACK_OPERATING_MODEL.md).
- If the task involves Picobot or Soothsayer, also consult the copy-ready repo guidance in [docs/repo-agents](./docs/repo-agents).
