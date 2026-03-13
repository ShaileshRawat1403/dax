# DAX Trust Model

## Purpose

Define what trust means in DAX as a session-level runtime property.

Trust in DAX is not:

- a UI badge
- a command-specific status
- a property of artifacts alone

Trust is the structured posture of a session based on the quality, completeness, and accountability of its execution trail.

## Trust Attachment Rule

**Trust posture belongs to the session, not to commands, panes, or individual artifacts.**

Commands and UI surfaces expose trust.
They do not define it.

This keeps trust stable across:

- CLI
- TUI
- future web surfaces
- audit and release workflows

## Working Definition

**Trust in DAX is the session-level assessment of whether AI-assisted work is sufficiently evidenced, governed, and reviewable for operator use.**

This definition makes trust broader than success or failure.

A session may complete successfully and still have weaker trust because of:

- missing evidence
- unresolved findings
- overrides
- incomplete approvals

## Design Principles

- Trust attaches to the full session lifecycle.
- Trust should be derived from structured signals, not vague confidence claims.
- Trust posture should be inspectable before it becomes fully verifiable.
- Trust should degrade predictably when governance or evidence quality declines.
- Trust should support future handoff and release-readiness logic.

## Trust Inputs

The session trust posture should be derived from several classes of inputs.

### 1. Approval Compliance

Questions:

- Were required approvals satisfied?
- Were approvals denied or bypassed?
- Did execution continue only after the correct checkpoints?

### 2. Policy Compliance

Questions:

- Did the session stay within policy boundaries?
- Were there policy violations or blocked actions?
- Did policy exceptions occur?

### 3. Artifact Completeness

Questions:

- Were expected outputs actually produced?
- Are outputs retained and inspectable?
- Is there enough output evidence to support review?

### 4. Audit Findings

Questions:

- Are there critical or blocking findings?
- Are warnings unresolved?
- Does the session contain trust-relevant concerns that affect handoff?

### 5. Override Presence

Questions:

- Did the session proceed through overrides?
- Were overrides justified?
- Do overrides materially reduce review confidence?

### 6. Execution Trace Integrity

Questions:

- Is there enough execution continuity to understand how the result was produced?
- Are planning, execution, approvals, outputs, and findings all connected to the same session?

## Trust Signals

Trust should come from structured signals, not ad hoc interpretation.

Recommended signal families:

- approval status
- policy status
- artifact presence
- evidence completeness
- audit severity
- override count
- trace continuity

These signals should later support both:

- operator-facing trust posture
- machine-checkable verification logic

## Trust Posture Ladder

Move beyond a flat label toward a session-level ladder.

Recommended ladder:

- `unknown`
- `review_needed`
- `policy_clean`
- `verified`
- `release_ready`

### Posture Semantics

- `unknown`: not enough evidence exists to make a reliable trust judgment
- `review_needed`: the session is inspectable, but one or more trust concerns still require operator review
- `policy_clean`: governance and policy expectations were satisfied, but broader evidence or release criteria may still be incomplete
- `verified`: evidence and trust signals are strong enough for confident internal handoff or review
- `release_ready`: the session meets the highest trust posture currently defined for downstream release or delivery use

## Trust Degradation

Trust should degrade in explicit ways.

Examples:

- missing approvals
- denied but unresolved checkpoints
- policy violations
- unverified or missing artifacts
- unresolved audit findings
- overrides without justification
- broken or incomplete execution trace continuity

These should not be treated as generic “warnings.” They are trust degraders.

## Relationship To Session Outcomes

Trust posture and session outcome are related, but not identical.

Examples:

- a session may be `completed` but only `review_needed`
- a session may be `completed_with_overrides` and never qualify as `verified`
- a session may be `blocked` before trust can rise above `unknown`

This separation is important.

Outcome answers:

- `Did execution finish?`

Trust answers:

- `How much should we rely on the result?`

## Relationship To Audit

Audit is the inspectable trust surface.

Trust is the underlying session property that audit explains.

Relationship:

- session owns trust posture
- audit exposes trust-relevant evidence and findings
- future verification should evaluate trust against explicit rules

This keeps `audit` from becoming the trust model itself.

## Relationship To Artifacts

Artifacts contribute to trust, but they do not define it.

Artifacts answer:

- `What outputs exist?`

Trust answers:

- `Are those outputs sufficiently governed and evidenced to rely on?`

That separation must stay intact.

## Relationship To Future Verification

This document does not define verification commands yet.

But it should support a future path such as:

- `audit verify`
- release-readiness checks
- evidence completeness checks
- trust gating rules

Those future systems should evaluate the session against this trust model, not invent a separate one.

## Non-Goals

This document does not define:

- audit verification command syntax
- release-readiness implementation
- trust scoring UI
- artifact hashing implementation
- session timeline implementation

Those are downstream consequences of the model.

## Recommended Next Documents

After this model, the most natural next design artifacts are:

- `DAX_SESSION_TIMELINE.md`
- `DAX_AUDIT_VERIFICATION.md`

The timeline should explain how trust-relevant session events accumulate over time.
The audit-verification doc should explain how the session trust model becomes enforceable.

## Guiding Sentence

**DAX trust posture is the session-level judgment of whether AI-assisted work is sufficiently governed, evidenced, and reviewable to rely on.**
