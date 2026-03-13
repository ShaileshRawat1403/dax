# DAX Release Surface

This document defines how DAX should expose release readiness as an operator-facing surface.

## Purpose

The release surface exists to show whether a session is operationally ready for handoff or shipping.

It should make the readiness judgment visible without collapsing it into trust verification or session inspection.

## Operator Questions

The first release surface should answer:

- Is this session ready for handoff?
- Is this session ready to ship?
- What is blocking readiness?
- What required evidence or outputs are missing?
- How is readiness different from verification?

## Product Boundary

Use this distinction consistently:

- `audit` inspects trust state
- `verify` judges trust state
- release readiness judges handoff or shipping readiness

Release readiness must consume verification. It must not replace it.

## First Surface Decision

The first release surface should be CLI-first.

This keeps readiness inspectable and operator-focused before it becomes a broader workstation concern.

## Recommended Command Shape

The clearest long-term grammar is:

```bash
dax release check <session-id>
```

Why this shape works:

- `release` names the operational domain directly
- `check` makes the action inspect-first rather than imperative
- it keeps release readiness separate from `verify`

Alternative forms like `dax ready <session-id>` are possible, but `dax release check` is clearer and less ambiguous.

## Presentation Model

The first CLI release surface should show:

- session id
- readiness result
- readiness level
- trust posture
- verification result
- passed readiness checks
- failed or incomplete readiness checks
- blocking factors

Human-readable output should let an operator understand readiness in seconds.

JSON output should expose the same structure for automation and later UI reuse.

## Relationship To Existing Surfaces

Release readiness should compose existing depth rather than invent new state.

- session history provides the durable record
- timeline explains progression
- audit explains trust state and findings
- verify judges trust state
- release readiness decides operational readiness above them

## Failure And Incomplete States

The first release surface should clearly separate:

- readiness failed because blockers exist
- readiness incomplete because required evidence is missing

This matters because a session can be trustworthy enough for review while still not being handoff-ready or release-ready.

## First Checks To Expose

The first readiness surface should likely expose:

- verification passed
- approvals complete
- required artifacts present
- blocking findings absent
- overrides justified
- trace continuity intact

These checks should be shown in operator language, not internal implementation terms.

## Non-Goals

The first release surface should not include:

- deployment actions
- publish/release automation
- remediation workflows
- UI integration in the same slice
- environment-specific deployment policy
- cross-session release scoring

## Acceptance Signals

This layer is successful when an operator can quickly see:

- whether a session is not ready, review-ready, handoff-ready, or release-ready
- what is blocking stronger readiness
- how readiness differs from verification
- which next missing inputs prevent handoff or shipping

## Product Rule

Keep this sequence intact:

- outcome says what happened
- trust posture says what affects trust
- verify says whether the session can be trusted
- release readiness says whether the trusted session is operationally ready
