# DAX Repo Agent Rules

Read this file first when working in the DAX repo.

## Identity

- DAX is the core standalone product in this stack.
- DAX is the governed AI and execution authority.
- DAX is not a companion-app dependency pretending to be a product.

## Product boundaries

- Preserve DAX as a usable standalone product for AI-assisted development.
- Keep run truth, approval truth, recovery truth, and audit truth canonical in DAX.
- Only change DAX for Picobot or Soothsayer when the change also makes sense for DAX as a real product or an intentional external interface.

## Anti-drift rules

- Do not let DAX become “just the backend” in product framing or architecture decisions.
- Do not add companion-specific shortcuts that weaken DAX's governance model by default.
- Do not reframe DAX as provider-first if its product identity is governed execution.

## Cross-repo context

- Read `docs/STACK_OPERATING_MODEL.md`.
- Remember the stack model:
  - `DAX = core product`
  - `Picobot = ingress`
  - `Soothsayer = operator plane`

## Local rules

- Respect any local write/read-only boundaries declared in the real repo-root `AGENTS.md`.
- Prefer explicit release notes and maintenance tasks over hidden destructive cleanup.
