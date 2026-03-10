# DAX Operator Surface Exposure

This document defines which truths belong in default operator surfaces, which belong in deeper inspection, and which should remain drilldown-only until a workstation surface is revisited.

The goal is not to expose every internal signal everywhere.

The goal is to make the most important truths visible at the right depth:

- fast orientation in `session list`
- compact operational truth in `session show`
- richer explanation in `session inspect`
- deeper judgment in `verify` and `release check`
- later workstation placement only after these defaults are stable in use

## Why This Exists

DAX now has stronger semantics across:

- lifecycle truth
- retained artifact truth
- verification and readiness judgment
- write-governance classification
- write outcome semantics

That means the next question is no longer "what is true?"

It is:

- what should operators see by default
- what should require one deeper command
- what should stay judgment-only
- what should stay workstation-only later

## Exposure Principles

### 1. Default surfaces should orient, not overwhelm

`session list` and `session show` should answer:

- what happened
- whether the session is safe to trust at a glance
- whether more review is required

They should not dump all verification detail.

### 2. Inspection surfaces should explain, not re-judge

`session inspect` should expose:

- lifecycle progression
- artifacts
- governance truth
- evidence summary

It should explain why a session looks the way it does, but not replace `verify` or `release check`.

### 3. Judgment surfaces should stay judgment surfaces

`verify` and `release check` should remain the canonical places for:

- trust severity
- readiness consequence
- blockers
- missing evidence

They can consume upstream truth, but should not become the only way to discover it.

### 4. Workstation default visibility should be conservative

When DAX returns to workstation/TUI exposure, the default session view should show only what helps operators stay oriented during execution.

Detailed governance and readiness semantics should remain drilldown or sidebar material unless repeated usage shows they belong in the primary view.

## Surface Decisions

## `session list`

Purpose:

- browse durable sessions quickly
- identify which sessions need attention

Must show by default:

- title
- outcome
- trust posture
- verification result
- updated time

May later include:

- a compact write-governance flag only if it improves browsing clarity without making the list noisy

Should not include by default:

- write risk bucket
- detailed write outcome wording
- readiness blockers
- verification explanations

Rationale:

`session list` is a browser, not a summary report.

## `session show`

Purpose:

- answer the one-glance question: "what state is this session in?"

Must show by default:

- outcome
- lifecycle
- stage
- trust posture
- verification result
- audit posture
- retained artifact count
- approvals/overrides counts
- compact write outcome
- compact write governance status

May show:

- write risk bucket when it helps make the governance status understandable in one line

Should not show by default:

- full verification checks
- detailed blocker lists
- timeline rows
- long policy explanations

Rationale:

`session show` is the compact operator truth surface.

## `session inspect`

Purpose:

- explain the session as a durable governed record

Must show by default:

- timeline
- artifact list
- audit posture summary
- verification summary
- stage progression
- write governance section

The write governance section should include:

- write outcome
- governance status
- write risk bucket
- short evidence-based summary

May later include:

- explicit write evidence references when they improve inspection clarity
- partial/blocked write detail if operators repeatedly need it

Should not become:

- a duplicate of `verify`
- a duplicate of `release check`

Rationale:

`session inspect` is the explanation surface, not the decision surface.

## `verify`

Purpose:

- answer: "how trustworthy is this session, and why?"

Must retain ownership of:

- trust result
- write-governance severity
- lifecycle completeness consequence
- evidence completeness
- findings resolution

Should not be required for:

- basic discovery that a write happened ungated

Rationale:

Operators should not need `verify` just to discover the presence of write-governance risk. They should need it to understand the trust consequence.

## `release check`

Purpose:

- answer: "is this session ready for handoff or release?"

Must retain ownership of:

- blockers
- missing evidence
- readiness grade
- readiness consequence of write-governance failures

Should not be required for:

- discovering that governed writes happened

Rationale:

Readiness is a later judgment, not the first discovery surface.

## Workstation / TUI Defaults

This document does not reopen full workstation design.

But it defines the likely default exposure split for later TUI work.

### Default workstation visibility

Good candidates for default visibility:

- lifecycle state
- trust posture
- pending approvals
- retained artifact count
- compact readiness/trust summary

### Sidebar or summary-card visibility

Good candidates for sidebar or compact summary cards:

- write governance status
- audit posture
- readiness state

### Drilldown / overlay visibility

Should remain drilldown or overlay material:

- write risk bucket detail
- write outcome explanation
- verification check-by-check output
- release blockers and missing evidence detail

Rationale:

The workstation should not collapse into a compliance dashboard by default.

## Current Recommendation

The current surface distribution is close to the right shape:

- `session show` = compact operational truth
- `session inspect` = deeper explanatory truth
- `verify` = trust judgment
- `release check` = readiness judgment

That means the next operator-surface work should be deliberate, not expansive.

The main future question is not "add more fields everywhere."

It is:

- which of these truths deserve default workstation visibility
- which should stay inspect-only
- which should stay judgment-only

## Non-Goals

This document does not:

- redesign TUI layout
- redefine trust or readiness semantics
- change write-governance policy
- change approval flow

## Success Signal

This surface model is working when:

- `session list` stays fast and readable
- `session show` is enough for quick operator truth
- `session inspect` explains the session without forcing `verify`
- `verify` and `release check` remain the authoritative decision surfaces
- future workstation work can adopt these boundaries instead of rediscovering them
