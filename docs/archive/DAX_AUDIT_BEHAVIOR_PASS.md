# DAX Audit Behavior Pass

This pass identifies the current trust/evidence substrate in canonical DAX, compares it with donor audit and `verify-ledger` semantics, and defines what should shape `dax audit` v1.

The goal is not to collect logs.
The goal is to discover what current behaviors already answer operator trust questions.

## 1. Canonical Runtime Reality

### Source

[packages/dax/src/rao/ledger.ts](../packages/dax/src/rao/ledger.ts)

### Trust Behavior Discovered

- records project-scoped ledger events
- event types already distinguish:
  - `run`
  - `audit`
  - `override`
- events may link to:
  - session id
  - message id
  - policy hash
  - contract hash

### Operator Question Answered

- what execution decisions were recorded?
- where did audit-relevant events happen?
- were approvals or overrides recorded in the trail?

### Current Visibility

- internal only

### Candidate Audit Value

- absorb now

Notes:

- this is the strongest canonical trust substrate because it records execution-relevant events explicitly instead of relying only on transcript text.

---

### Source

[packages/dax/src/governance/next.ts](../packages/dax/src/governance/next.ts)

### Trust Behavior Discovered

- records permission evaluation events into the ledger
- records approval replies and override behavior
- stores persisted approvals and applies replay logic
- preserves session linkage for approval events

### Operator Question Answered

- where was human approval required?
- what was allowed, denied, or persisted?
- did an override affect this execution path?

### Current Visibility

- partially surfaced

### Candidate Audit Value

- absorb now

Notes:

- approvals are already visible as a live operator surface; audit can turn them into trust history and review posture.

---

### Source

[packages/dax/src/session/summary.ts](../packages/dax/src/session/summary.ts)

### Trust Behavior Discovered

- computes and persists session diffs
- summarizes file-level changes across execution
- publishes session diff events as part of session review

### Operator Question Answered

- is there a change trail that supports review?
- what concrete file-level evidence exists for this run?

### Current Visibility

- operator-visible already

### Candidate Audit Value

- absorb now

Notes:

- diffs are not the audit surface themselves, but they are critical evidence inputs for trust summaries.

---

### Source

[packages/dax/src/session/processor.ts](../packages/dax/src/session/processor.ts)

### Trust Behavior Discovered

- completed tool calls persist timing, metadata, output, and attachments
- tool errors preserve interrupted or blocked execution state
- permission and question rejection states influence execution flow

### Operator Question Answered

- did execution actually happen the way DAX says it did?
- where was execution blocked, interrupted, or completed?
- what output or attachment evidence exists for a given tool step?

### Current Visibility

- partially surfaced

### Candidate Audit Value

- absorb later

Notes:

- these behaviors strengthen audit as a synthesis layer, but they should not force raw tool-event dumping into `dax audit` v1.

---

### Source

[packages/dax/src/audit/index.ts](../packages/dax/src/audit/index.ts)

### Trust Behavior Discovered

- produces structured audit findings
- computes pass/warn/fail status
- supports gating decisions
- includes next actions and metadata such as trigger and project id
- ties trust posture to release and policy readiness

### Operator Question Answered

- is this work ready for review or release?
- what trust-relevant problems exist right now?
- what should be fixed before handoff?

### Current Visibility

- operator-visible already

### Candidate Audit Value

- absorb now

Notes:

- this is already a trust summary surface, but it is focused on SDLC readiness rather than the broader execution trail.

---

### Source

[packages/dax/src/session/prompt.ts](../packages/dax/src/session/prompt.ts)

### Trust Behavior Discovered

- exposes `/audit`, `/audit gate`, and `/audit explain`
- supports audit profile selection
- supports auto-audit triggers after important workflow moments

### Operator Question Answered

- how do I inspect trust posture during normal work?
- what changed after docs/policy/review actions?
- can I explain a trust-relevant finding directly?

### Current Visibility

- operator-visible already

### Candidate Audit Value

- absorb now

Notes:

- the command UX already points in the right direction: audit as an operator-facing trust summary with drill-down.

---

### Source

[docs/release-readiness.md](./release-readiness.md)

### Trust Behavior Discovered

- release readiness already expects structured diagnostics
- readiness is treated as a product-level state, not a hidden build concern

### Operator Question Answered

- is this environment and execution trail ready to proceed?
- what is blocked, and what is still explainable or intentional?

### Current Visibility

- operator-visible already

### Candidate Audit Value

- absorb later

Notes:

- release readiness is adjacent to audit, but should not be collapsed into the first audit surface automatically.

## 2. Donor Semantics

### Source

[cli/commands/audit.ts](../cli/commands/audit.ts)

### Trust Behavior Discovered

- explicit audit command listing ledger events
- lightweight operator view over trust-relevant event history

### Operator Question Answered

- what trust-relevant events were recorded?

### Current Visibility

- surfaced in donor CLI

### Candidate Audit Value

- absorb now as operator framing

Notes:

- the donor implementation is thin, but it reinforces that audit should be directly inspectable, not buried.

---

### Source

[cli/commands/verify-ledger.ts](../cli/commands/verify-ledger.ts)

### Trust Behavior Discovered

- trust is not only viewable, it can be checked
- integrity is a first-class operator concern

### Operator Question Answered

- can the recorded execution trail be trusted as intact?

### Current Visibility

- surfaced in donor CLI

### Candidate Audit Value

- absorb later as conceptual verification posture

Notes:

- the key donor value is not the command name.
- the key donor value is the explicit integrity question:
  - trace can be verified, not just displayed.

---

### Source

[core/ledger/index.ts](../core/ledger/index.ts)

### Trust Behavior Discovered

- append-only ledger rows
- hash chaining
- explicit verification result

### Operator Question Answered

- is the event trail internally consistent?

### Current Visibility

- internal only behind donor CLI

### Candidate Audit Value

- absorb later as mental model

Notes:

- canonical DAX should preserve the trust concept, not revive the exact donor storage implementation.

## 3. Canonical V1 Opportunity

What is already real in canonical DAX:

- trust-relevant event recording
- approval and override recording
- session-linked diff evidence
- structured audit findings, summaries, and gates
- operator-facing audit flows in prompt/command UX

What is missing:

- a single operator-facing surface that synthesizes:
  - approval/override history
  - evidence linkage
  - readiness/trust posture

What should wait until later:

- explicit integrity verification command or subcommand
- raw ledger inspection as the primary default surface
- low-level event chain tooling

## 4. Likely Direction For `dax audit` V1

`dax audit` v1 should probably be an inspect-first trust summary.

It should answer:

`What happened that matters for trust, and is there enough evidence to review this confidently?`

That suggests:

- trust summary
- findings or warnings
- approval/override highlights
- evidence linkage
- readiness or review posture
- readable and JSON modes

It should not default to:

- raw logs
- raw ledger rows
- standalone integrity verification first

## 5. Reuse Matrix

| Source | Trust behavior | Current visibility | Candidate value | Decision |
| --- | --- | --- | --- | --- |
| `rao/ledger.ts` | trust-relevant execution events | internal only | high | absorb now |
| `governance/next.ts` | approval and override recording | partially surfaced | high | absorb now |
| `session/summary.ts` | persisted diff evidence | operator-visible already | high | absorb now |
| `session/processor.ts` | execution-step timing/output trail | partially surfaced | medium | absorb later |
| `audit/index.ts` | findings, gates, readiness summaries | operator-visible already | high | absorb now |
| `session/prompt.ts` audit commands | operator-facing audit UX | operator-visible already | high | absorb now |
| donor `audit` command | inspectable trust event surface | surfaced in donor CLI | medium | absorb framing now |
| donor `verify-ledger` | explicit integrity-check posture | surfaced in donor CLI | medium | absorb later as concept |
| donor `core/ledger` | hash-chain verification model | internal only | medium | absorb mental model only |

## 6. Next Step

Use this pass to define `docs/DAX_AUDIT_IMPLEMENTATION_V1.md` before changing the canonical audit command surface.
