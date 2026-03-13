# DAX Release Readiness

This document defines how DAX should model release readiness as a product judgment layer above session inspection and verification.

## Purpose

Release readiness answers a different operator question than verification.

- `verify` asks: can this session be trusted?
- release readiness asks: is this trusted session ready for handoff or shipping?

The goal is to give operators a clear readiness judgment grounded in session evidence, trust posture, and required outputs.

## Operator Questions

Release readiness should answer:

- Is this session ready for handoff?
- Is this session ready to ship?
- What is blocking readiness?
- What evidence is missing?
- How is readiness different from verification?

## Boundary From Verification

Verification and release readiness must stay separate.

- verification judges trust over session-attached signals
- release readiness judges operational completeness for handoff or shipping

A session may be:

- completed but not verified
- verified but not handoff-ready
- handoff-ready but not release-ready

Release readiness must consume verification. It must not replace it.

## Minimum Readiness Inputs

The first readiness model should evaluate:

- verification result
- trust posture
- required artifacts present
- approvals complete
- blocking audit findings absent
- unjustified overrides absent
- trace continuity intact

Later versions may add workflow-specific requirements, but v1 should stay narrow and session-centered.

## Readiness Outcomes

The first readiness ladder should be:

- `not_ready`
- `review_ready`
- `handoff_ready`
- `release_ready`

These should be interpreted as:

- `not_ready`: major trust or completeness blockers remain
- `review_ready`: enough evidence exists for review, but not operational handoff
- `handoff_ready`: session is sufficiently complete for downstream operator or team handoff
- `release_ready`: session is trusted and operationally complete for shipping

## Blocking Factors

The first readiness model should treat these as blockers:

- verification failed or incomplete
- required artifacts missing
- unresolved blocking audit findings
- unjustified overrides
- approval gaps
- broken trace continuity

These factors should explain why a session is not yet ready for stronger outcomes.

## Relationship To Existing Surfaces

Release readiness should sit on top of existing DAX surfaces:

- session history: browse the record
- timeline: inspect progression
- audit: inspect trust state and findings
- verify: judge trust state

Release readiness should not become a replacement for any of them. It should compose them into an operational handoff or shipping judgment.

## First Surface Direction

The first surface should remain CLI-first.

A likely later sequence is:

1. define readiness model
2. add a narrow CLI readiness surface
3. expose readiness in workstation/history surfaces later

This keeps readiness inspectable before it becomes a broader UI concern.

## Non-Goals

The first release-readiness model should not include:

- deployment workflows
- automated publishing
- remediation workflows
- cross-session readiness scoring
- UI integration in the same slice
- environment-specific deploy policy logic

## Acceptance Signals

This layer is successful when an operator can quickly understand:

- whether a session is ready for review, handoff, or release
- what is blocking stronger readiness
- how readiness differs from verification
- which evidence or outputs are still missing

## Product Rule

Use this distinction consistently:

- timeline explains progression
- audit inspects trust
- verify judges trust
- release readiness judges operational handoff or shipping readiness
