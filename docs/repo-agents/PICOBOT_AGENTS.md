# Picobot Repo Agent Rules

Read this file first when working in the Picobot repo.

## Identity

- Picobot is the ingress layer in the DAX stack.
- Picobot is not the core AI authority.
- Picobot should stay lightweight, fast to understand, and easy to route through DAX.

## Product boundaries

- Default happy path should align to DAX-backed authority when that is the intended architecture.
- Keep branding, ingress UX, and multi-channel routing strong, but avoid rebuilding governance or execution logic that belongs in DAX.
- Picobot can support convenience flows and channel adapters, but not its own silent policy universe.

## Anti-drift rules

- Do not let Picobot drift into “independent AI agent platform” territory unless that is an explicit product decision.
- Do not prioritize paid-provider setup over the intended DAX-backed route if DAX auth is the planned main experience.
- Do not duplicate policy or approval systems locally when DAX already owns them.

## Cross-repo context

- Read `docs/STACK_OPERATING_MODEL.md` from the DAX repo.
- Remember the stack model:
  - `DAX = core product`
  - `Picobot = ingress`
  - `Soothsayer = operator plane`

## Practical default

- When in doubt, make Picobot a thinner, clearer ingress surface rather than a thicker competing runtime.
