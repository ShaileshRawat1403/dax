# DAX Write Governance Enforcement

This document defines the next narrow governance layer after lifecycle truth, artifact truth, and inspection-path resilience.

It focuses on one remaining operator-trust problem:

```text
write intent happened
files were created
artifact truth is visible
but governance expectations are still not explicit enough
```

## Purpose

Define:

- write classes
- when approval is expected
- which writes are safe without approval
- which writes are governed and must surface visibly
- how partial, blocked, denied, or ungated writes should affect trust surfaces

## Evidence From Validation

Validation confirmed:

- lifecycle truth can now distinguish unfinished lightweight runs from completed artifact-heavy runs
- created files now appear as retained artifacts
- inspection surfaces are resilient against transient lock contention

The remaining question is governance quality, not visibility:

```text
when should write intent have triggered visible governance?
```

## Problem Boundary

This layer is not about:

- TUI layout
- artifact redesign
- timeline redesign
- new lifecycle semantics

This layer is about enforcement truth:

```text
write intent -> governance expectation -> outcome -> trust consequence
```

## Write Classes

### 1. Safe workspace writes

Low-risk writes inside the project workspace that do not require approval under current policy.

Examples:

- generating a local report file
- writing documentation inside a project-owned directory
- creating small derived outputs in known artifact folders

Expected behavior:

- no approval required
- write remains governed by policy evaluation
- retained artifacts should still be visible
- trust surfaces should show that write occurred under allowed conditions

### 2. Governed writes

Writes that should require explicit approval because they cross a higher-risk boundary.

Examples:

- editing protected files
- modifying configuration with production impact
- writing outside the project workspace
- destructive or sweeping rewrites

Expected behavior:

- approval should surface before write execution
- denial or pending approval should block completion
- trust and readiness should reflect the unresolved write governance state

### 3. Disallowed writes

Writes that policy should deny outright.

Expected behavior:

- no write should be executed
- the denial should remain visible in session inspection and trust surfaces

## Governance Expectations

For every write-capable action, DAX should be able to answer:

1. Was write intent present?
2. Was approval required?
3. Was approval requested?
4. Was approval granted, denied, or bypassed?
5. Did the write occur?
6. Did created files become retained artifacts?
7. Does trust/readiness reflect the governance outcome?

If DAX cannot answer those questions, write governance is incomplete.

## Enforcement Rules

### Safe write path

If policy allows the write without approval:

- write may proceed
- created files must be indexed as retained artifacts when durable
- verification should not treat the write itself as suspicious
- readiness should continue to depend on evidence, audit, and policy completeness

### Approval-gated write path

If policy requires approval:

- approval must appear before write execution
- pending approval means the session is not ready
- denied approval means the session should reflect blocked governance outcome
- granted approval allows the write and preserves a visible governance trace

### Ungated write anomaly

If a write occurs but DAX cannot show the expected approval or policy basis, that is a governance anomaly.

Expected consequence:

- trust posture should degrade or remain incomplete
- verification should surface a write-governance concern
- release readiness should not silently treat the session as clean

### Partial write outcome

If some writes succeed and others fail, or if files are created before the overall task fails:

- retained artifacts should still be visible
- inspection should show the session as partial or incomplete from a governance perspective
- readiness should remain blocked or incomplete as appropriate

## Surface Expectations

### `session show`

Should communicate enough to indicate whether the session involved governed writes and whether unresolved write governance remains.

### `session inspect`

Should expose:

- retained write outputs
- approval/gating trace relevant to writes
- enough evidence to understand whether writes were governed correctly

### `verify`

Should eventually include a write-governance judgment such as:

- writes allowed under policy
- write approvals complete
- write governance incomplete
- write governance anomaly detected

### `release check`

Should eventually treat unresolved or anomalous governed writes as a blocker or missing evidence, not as a silent success.

## Minimal First Implementation Direction

The first enforcement slice should stay narrow.

It should do only this:

1. identify whether a session includes write-capable actions
2. identify whether approvals were expected or observed
3. expose missing or anomalous governance on trust/readiness surfaces

It should not yet:

- redesign policy matching
- add new UI
- redesign artifact storage
- infer complex risk from content semantics

## Acceptance Signals

This layer is successful when:

1. write-capable sessions clearly indicate whether the write was safe, approved, blocked, or anomalous
2. ungated writes no longer look indistinguishable from properly governed writes
3. `verify` and `release check` can reflect unresolved write governance explicitly
4. existing lifecycle and artifact truth behavior does not regress
