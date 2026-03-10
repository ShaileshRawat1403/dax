# DAX Audit Implementation V1

## 1. Command Purpose

`dax audit` exposes a trust-oriented summary of execution events, approvals, overrides, evidence, and audit findings relevant to operator review.

This command should be:

- operator-facing
- trust-oriented
- summary-first

It should not be a raw event browser.

## 2. Operator Question

`dax audit` v1 should answer:

- what happened that matters for trust?
- were approvals or overrides involved?
- what evidence exists for review?
- are there audit findings or gates I should care about?

This is the anchor for the command.

## 3. Ownership Boundary

`audit` owns:

- trust summary
- audit findings and gates
- approval and override visibility
- evidence linkage
- review posture

`audit` does not own:

- raw full logs
- artifact browsing
- generic session history
- full verification engine
- policy authoring

## 4. Canonical Reuse Points

The command must read from existing canonical trust substrate, not invent a new audit store.

Primary reuse points:

- [packages/dax/src/rao/ledger.ts](../packages/dax/src/rao/ledger.ts)
- [packages/dax/src/governance/next.ts](../packages/dax/src/governance/next.ts)
- [packages/dax/src/session/summary.ts](../packages/dax/src/session/summary.ts)
- [packages/dax/src/audit/index.ts](../packages/dax/src/audit/index.ts)
- [packages/dax/src/session/prompt.ts](../packages/dax/src/session/prompt.ts)

What each contributes:

- ledger events:
  - trust-relevant event history
- governance state:
  - approvals and overrides
- session summaries:
  - diff evidence
- audit module:
  - findings, gates, status, next actions
- existing command UX:
  - profile, explain, gate flows

## 5. Input Model

V1 should stay narrow.

Support:

- default audit summary for current project/session context
- optional session selector if already natural
- JSON output mode

Examples:

```bash
dax audit
dax audit --session <session-id>
dax audit --format json
```

Subcommands or modes such as `gate` and `explain` may remain where already supported, but the v1 contract should focus on the summary surface first.

## 6. V1 Output Contract

### Human-Readable Mode

Should present a compact trust summary including:

- target session or project context
- approval / override summary
- evidence present summary
- audit findings count and severity posture
- gate or readiness signal
- next actions where relevant

### JSON Mode

Should return a stable structured object.

Suggested schema direction:

```json
{
  "type": "audit_summary",
  "session_id": "session_123",
  "posture": "review_needed",
  "approvals": {
    "requested": 2,
    "overrides": 1
  },
  "evidence": {
    "diff_present": true,
    "artifacts_present": true
  },
  "findings": {
    "status": "warn",
    "blocker_count": 0,
    "warning_count": 2,
    "info_count": 1
  },
  "next_actions": [
    "Review high-severity documentation findings",
    "Confirm remaining approvals are understood"
  ]
}
```

This is a contract direction, not a final locked payload yet.

## 7. Readiness / Posture Model

V1 should communicate a trust posture, not just raw data.

Recommended posture family:

- `clear`
- `review_needed`
- `blocked`

Suggested interpretation:

- `clear`: enough trust-relevant signal exists and no blocking issues are present
- `review_needed`: execution is reviewable but findings, approvals, or evidence gaps need attention
- `blocked`: trust posture is insufficient for confident handoff or release

The operator should be able to answer:

`Is this execution trail reviewable and trustworthy enough to proceed?`

## 8. Notable Content Included In V1

Include:

- approvals and overrides
- evidence presence
- diff trail presence
- audit findings and gates
- trust posture summary

Do not include:

- raw event stream dumps by default
- full verification routines
- detailed artifact browsing

## 9. Non-Goals

- no raw ledger dump as the main surface
- no standalone verification action yet
- no artifact mutation
- no generic log explorer
- no new audit engine
- no renaming pressure from donor command names

## 10. Test Plan

Cover focused trust-summary scenarios:

- empty or minimal trust state
- approvals present
- overrides present
- findings and gate posture present
- JSON contract stability
- optional session scoping if implemented

At minimum:

- readable output with no blockers
- readable output with review-needed posture
- readable output with blocked posture
- stable JSON output shape

## 11. Deferred Questions

- should verification later live under `audit verify`?
- when should posture become stricter or more granular?
- should audit posture integrate directly with release readiness?
- how much raw event detail should be drill-down versus default summary?

## 12. Acceptance Signals

### Product

- audit answers trust questions without flooding the operator with internals
- audit stays clearly separate from artifacts

### Architecture

- command reuses canonical trust substrate
- no separate audit store is introduced

### UX

- output is concise and trust-oriented
- posture is visible
- next actions are clear when review is needed
