# DAX Audit Design Pass

## 1. Purpose

Audit in DAX is the inspectable record of execution decisions, checkpoints, and evidence relevant to operator trust.

This is not generic logging.
This is not raw implementation trace spam.

Audit exists to help an operator understand what happened that matters for trust.

## 2. Operator Question

`audit` should answer questions like:

- what happened that matters for trust?
- what approvals or overrides affected this run?
- what evidence supports this execution outcome?
- is this work ready for review, handoff, or release?

That is broader than “what outputs exist?”

Artifacts answer:

- what was produced

Audit should answer:

- why the execution trail can be trusted

## 3. Ownership Boundary

`audit` should own:

- trust-relevant execution trace
- approval and override visibility
- operator-facing verification posture
- evidence-oriented summaries
- readiness or review-relevant findings

`audit` should not own:

- generic file browsing
- artifact listing
- low-level raw logs as the primary product
- ad hoc implementation internals with no operator value

## 4. Relationship To The Existing Grammar

The current canonical operator grammar is:

- `plan`
- `run`
- `approvals`
- `artifacts`

`audit` should sit above those surfaces.

Relationship:

- `plan` defines work
- `run` executes work
- `approvals` exposes checkpoints
- `artifacts` exposes retained outputs
- `audit` explains the trust posture of that whole execution trail

This means audit should feel like a synthesis surface, not a replacement for the other commands.

## 5. What Trust Requires

The audit layer should likely reason about:

- execution trace continuity
- approvals and overrides
- retained outputs and evidence references
- policy-relevant decisions
- readiness or review posture

This should be expressed as operator-relevant findings, not raw event dumps by default.

## 6. Possible V1 Shape

Human-readable mode:

- trust summary
- findings or warnings
- approval/override highlights
- evidence references
- readiness posture

JSON mode:

- stable structured trust summary
- findings list
- linked sessions, artifacts, and checkpoints where relevant

## 7. Relationship To Verification

Do not decide too early whether verification must be a separate command.

Two possible futures:

### Option A

- `audit` includes verification summaries

### Option B

- `audit` inspects trust posture
- `verify` actively checks integrity/readiness later

For now, the important thing is to define the trust surface first.

## 8. Relationship To Existing Runtime

The next pass should inspect canonical trust-related runtime behavior such as:

- approvals and override recording
- audit/ledger events
- release-readiness artifacts
- policy and review surfaces

It should also compare donor semantics such as:

- `verify-ledger`
- any legacy audit framing

## 9. Non-Goals

- no command implementation yet
- no lock-in to `verify-ledger` naming
- no raw-log browser
- no trust scoring gimmicks
- no artifact redesign

## 10. Acceptance Signals

This design layer is successful when:

- DAX has a clear definition of audit as a trust surface
- audit is separated from artifacts
- audit is positioned as an operator-facing synthesis layer
- the next behavior pass has a clear target

## 11. Next Step

Before any implementation:

1. inspect canonical trust/evidence-related runtime behavior
2. compare donor audit and `verify-ledger` semantics
3. write the audit behavior pass
4. define the v1 implementation contract for `dax audit`
