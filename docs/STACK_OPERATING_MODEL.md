# Stack Operating Model

This document is the canonical cross-repo context for the DAX-centered coding runtime stack. It exists to reduce drift, repeated explanation, and accidental architecture inversion when agents or contributors work in different repositories.

Within the broader Sans Serif Systems suite, Flowright owns durable enterprise
workflow/state-machine truth and Soothsayer owns the operator cockpit. DAX stays
a standalone governed coding runtime and the execution authority for DAX runs.

## One-Line Stack Model

`DAX = standalone governed coding runtime`
`Picobot = ingress`
`Soothsayer = operator plane`

## Core Product Hierarchy

| Layer | Product | Role | What it must not drift into |
| --- | --- | --- | --- |
| 1 | `dax` | Standalone governed coding runtime and DAX-run execution authority | A generic workflow authority or hidden implementation detail |
| 2 | `picobot` | Lightweight ingress layer that feeds work into DAX | A separate AI authority or policy engine |
| 2 | `soothsayer` | Operator and control plane for observing, supervising, and recovering DAX work | A second execution authority or broad product fork |

## What DAX Is

DAX is the standalone governed coding runtime in this stack.

DAX should be treated as:
- a standalone governed execution workstation
- the execution authority for DAX runs
- the source of run truth, approval truth, audit truth, and recovery truth

DAX should not be treated as:
- a hidden runtime behind another product's identity
- a convenience adapter for companion-repo UI choices
- a place to absorb companion-repo drift without a deliberate product reason

## What Picobot Is

Picobot is a lightweight ingress surface built around DAX.

Picobot should be treated as:
- the thin front door for messages, channels, and quick operational ingress
- DAX-backed when a message becomes governed coding execution
- a product that should stay simple, reliable, and easy to route through DAX

Picobot should not be treated as:
- a separate policy authority
- a paid-API-first product if DAX-backed Pro/Plus authority is the intended happy path
- a place to duplicate governance or execution logic that belongs in DAX

## What Soothsayer Is

Soothsayer is the operator and control plane for DAX.

Soothsayer should be treated as:
- the multi-user observation, governance, and intervention surface
- DAX-first when a request becomes governed coding execution
- the web operator plane that sits above DAX, not beside it

Soothsayer should not be treated as:
- the owner of DAX run lifecycle truth
- the place where DAX governance gets redefined locally

## Non-Drift Rules

These rules should stay stable unless there is an explicit product decision to change them.

1. DAX is the center of gravity for governed coding execution.
2. Picobot and Soothsayer should align to DAX for DAX runs, not pull DAX off-course by accident.
3. Direct providers in Soothsayer chat are acceptable for ordinary inline assistance; DAX mode is the explicit switch into governed coding execution.
4. DAX run state, approval state, and recovery state should stay canonical in DAX.
5. Companion repos may shape UX, workflow, and supervision, but they should not silently fork authority.
6. Secrets for optional integrations should not be carried by default just because they existed historically.
7. Database cleanup and legacy retirement should be handled as explicit maintenance, not hidden inside product releases.

## AI Authority Model

Use this mental model when deciding where AI behavior should live:

- Default assistant authority: configured provider for ordinary chat; DAX when the operator explicitly requests governed coding execution
- Execution authority: DAX
- Approval authority: DAX
- Recovery authority: DAX
- Ingress convenience: Picobot
- Multi-user operator supervision: Soothsayer

Do not let direct providers silently mutate code, publish, deploy, or recover
runs. Those actions must enter governed DAX or Flowright paths with explicit
operator approval.

## Integration Rules

### OAuth and provider secrets

- DAX-backed Gemini Pro/Plus access is not the same thing as Google Drive OAuth.
- Do not keep unrelated Google OAuth secrets enabled unless the integration is intentionally in use.
- If a repo is not using an integration right now, prefer disabling or removing that config instead of leaving stale secrets in place.

### Releases

- Do not hide destructive maintenance work inside feature releases.
- If Prisma or schema sync wants to drop legacy tables, handle that as a separate maintenance task unless the release is explicitly a migration release.
- Prefer honest scope notes over forcing “clean” automation.

### Cross-repo work

- Read the local `AGENTS.md` first in the repo you are editing.
- Then read this document.
- Then read the repo README and any release-readiness or architecture docs relevant to the task.

## Safe Future Work Checklist

Before making substantial changes in any repo, confirm:

- Which repo owns the behavior?
- Does this change preserve `DAX = governed coding execution authority`?
- Is this adding a new fallback, or silently replacing the intended governed path?
- Is this a product change, an integration change, or maintenance?
- Does this belong in a release, or in a separate cleanup task?

## Repo-Specific Agent Files

Copy-ready repo-specific `AGENTS.md` content lives in:

- [docs/repo-agents/DAX_AGENTS.md](./repo-agents/DAX_AGENTS.md)
- [docs/repo-agents/PICOBOT_AGENTS.md](./repo-agents/PICOBOT_AGENTS.md)
- [docs/repo-agents/SOOTHSAYER_AGENTS.md](./repo-agents/SOOTHSAYER_AGENTS.md)

These are intended to be copied into the root of each repo so future agents inherit the same picture without requiring repeated human explanation.
