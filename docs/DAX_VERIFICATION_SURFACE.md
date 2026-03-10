# DAX Verification Surface

## Purpose

Define the first operator-facing verification surface for DAX.

This surface exists to:

- expose trust judgment over a session
- show what passed, failed, or remains incomplete
- explain how verification affects trust posture

Verification is not session history and not live execution narration.

It is the place where DAX answers:

> Is this session verified, and what still blocks stronger trust posture?

## Operator Questions

The verification surface should answer:

- Is this session verified?
- What evidence supports that result?
- What is incomplete?
- What degraded trust?
- What blocks higher posture such as `verified` or `release_ready`?

## First Surface Decision

### Chosen direction

Start with a narrow CLI verification surface first.

This is the safest next step because it:

- reuses the existing trust and verification model
- exposes judgment without forcing UI placement too early
- keeps the output structured and inspect-first

### Recommended naming

The cleanest long-term product language is:

- `audit` = inspect
- `verify` = judge

That means:

- `audit` remains the trust inspection surface
- `verify` becomes the trust judgment surface

### Preferred CLI shape

Preferred direction:

- `dax verify <session-id>`

Acceptable fallback if needed:

- `dax session verify <session-id>`

The important rule is not the exact command path.
It is that verification remains distinct from audit.

## Relationship Boundaries

This separation must stay explicit.

### Timeline

Timeline answers:

- what meaningful progression happened in the session

Timeline may include trust-related milestones such as:

- audit issue detected
- trust posture updated

But timeline does not judge verification completeness.

### Audit

Audit answers:

- what trust state is visible right now
- what findings, posture, and evidence indicators are present

Audit inspects trust state.
It does not own verification judgment.

### Verification

Verification answers:

- whether the current session evidence justifies a stronger or weaker trust posture

Verification evaluates trust signals.

## Presentation Model

The first CLI verification surface should be concise and structured.

### Required output shape

- overall verification result
- resulting trust posture
- checks that passed
- checks that failed
- checks that remain incomplete
- degrading factors

### Example shape

- `Verification result: incomplete`
- `Trust posture: review_needed`
- `Passed: approvals, policy compliance`
- `Failed: findings resolution`
- `Incomplete: artifact completeness`
- `Degrading factors: unresolved audit findings`

This should read like judgment, not like a log or timeline.

## Verification Inputs Shown To The Operator

The first verification surface should evaluate and expose session-level inputs such as:

- approvals
- policy compliance
- artifacts
- evidence completeness
- audit findings resolution
- overrides
- trace continuity

These should be presented as checks or signals, not as raw internal payloads.

## Output Semantics

Verification should affect trust posture, not session outcome.

That means:

- a session may be `completed` but still `incomplete` from a verification standpoint
- a session may be `blocked` and still preserve inspectable verification signals

This surface should reinforce that distinction clearly.

## V1 Non-Goals

The first verification surface should not include:

- release-readiness judgment
- remediation workflows
- auto-fix suggestions
- cross-session verification
- workstation integration in the same slice
- policy authoring or override management

## Acceptance Signals

The verification surface is successful when an operator can quickly determine:

- whether the session is verified
- what caused failure or incompleteness
- what factors degraded trust posture
- what still blocks stronger readiness

## Summary

The cleanest next product step is:

- a narrow CLI verification surface

The cleanest product language is:

- `audit` inspects
- `verify` judges

That keeps trust inspection, session progression, and trust judgment separate as DAX grows.
