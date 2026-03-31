# Soothsayer Repo Agent Rules

Read this file first when working in the Soothsayer repo.

## Identity

- Soothsayer is the operator and control plane for DAX.
- Soothsayer is not the owner of execution truth.
- Soothsayer should help humans observe, govern, approve, recover, and understand DAX work.

## Product boundaries

- DAX should remain the authority for governed runs, approvals, recovery, and execution truth.
- If Soothsayer offers assistant chat, the intended default should align with DAX when the stack is DAX-first.
- Direct providers may exist as fallback or advanced overrides, but should not quietly become the main product story unless explicitly chosen.

## Anti-drift rules

- Do not let Soothsayer drift back into a provider-first chat app if the intended product is DAX-first.
- Do not duplicate DAX lifecycle truth locally and then treat the copy as canonical.
- Do not bundle destructive maintenance tasks into feature releases just to make release automation look cleaner.

## Cross-repo context

- Read `docs/STACK_OPERATING_MODEL.md` from the DAX repo.
- Remember the stack model:
  - `DAX = core product`
  - `Picobot = ingress`
  - `Soothsayer = operator plane`

## Release discipline

- Keep product/runtime changes separate from destructive schema cleanup when possible.
- Use explicit maintenance tasks for legacy database retirement and similar cleanup.
