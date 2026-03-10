# DAX Workstation Overlay Layouts

This document defines the internal layout of workstation overlays for the balanced DAX workstation.

It builds on the already locked workstation rules:

- center = narrative
- sidebar = truth
- overlays = evidence

It does not redefine which overlays exist. That is already covered in [DAX_WORKSTATION_OVERLAY_SPEC.md](DAX_WORKSTATION_OVERLAY_SPEC.md).

This document defines how each overlay should be structured so the evidence layer feels consistent and readable.

## Shared Overlay Layout Contract

Every workstation overlay should follow the same top-level structure:

1. `Header`
2. `Summary`
3. `Evidence sections`
4. `Footer actions`

This structure is a hard consistency rule.

Operators should always be able to answer these questions in the same order:

- what am I looking at?
- what is the high-level result?
- what evidence explains it?
- what can I do next?

## Shared Layout Rules

### 1. Start with summary, not evidence

The first screenful should explain the result before showing details.

Overlays should not open with:

- raw lists
- raw logs
- raw findings
- deep technical traces

### 2. Keep evidence grouped

Evidence should be grouped into short labeled sections, not presented as an undifferentiated block.

Good section shapes:

- `Checks`
- `Blockers`
- `Missing evidence`
- `Signals`
- `Artifacts`
- `Stages reached`

### 3. Avoid raw internal terminology

Operator-facing labels should be preferred over implementation jargon.

For example:

- `Write governance` instead of internal evaluator names
- `Retained artifacts` instead of storage-specific language
- `Verification result` instead of internal status object terminology

### 4. Do not dump raw logs

These overlays are explanation surfaces, not debugging consoles.

Avoid exposing:

- raw ledger events
- raw audit dumps
- raw policy traces
- raw transcript chunks

### 5. Fit a coherent first screen

The first visible region should fit within a normal terminal height without feeling like an endless report.

Scrolling is acceptable, but the summary and most important evidence should appear immediately.

### 6. Footer actions stay minimal

Overlay footer actions should stay lightweight:

- close
- scroll/navigation hints
- occasional context-specific review action where already justified

They should not become toolbars.

## Overlay Layouts

## 1. Verify Overlay

Purpose:

- explain trust judgment
- show what passed, failed, degraded, or remains incomplete

### Layout

#### Header

```text
VERIFY
```

#### Summary

Must show:

- trust posture
- verification result

Example:

```text
Trust posture
Review needed

Summary
Verification incomplete
```

#### Evidence Sections

Order:

1. `Checks`
2. `Reasons`
3. `Evidence`

Example:

```text
Checks
+ Lifecycle completion
+ Artifact retention
! Policy evaluation missing
! Write governance ungated

Reasons
Policy evidence is incomplete
Project write occurred without expected governance signal

Evidence
Session lifecycle: completed
Artifacts retained: 3
Write outcome: completed_ungated
```

#### Footer Actions

```text
[q] close
```

### Verify Overlay Rules

- checks come before supporting evidence
- reasons stay concise
- do not dump audit findings in raw form
- do not include release-readiness reasoning beyond what is necessary for trust

## 2. Release Overlay

Purpose:

- explain readiness judgment for handoff or shipping

### Layout

#### Header

```text
RELEASE READINESS
```

#### Summary

Must show:

- readiness result

Example:

```text
Result
Review ready
```

#### Evidence Sections

Order:

1. `Blockers`
2. `Missing evidence`
3. `Signals`

Example:

```text
Blockers
None

Missing evidence
Policy evaluation
Security review

Signals
Lifecycle completed
Artifacts retained
Write governance: project_artifact
```

#### Footer Actions

```text
[q] close
```

### Release Overlay Rules

- blockers always come first
- missing evidence is separate from blockers
- keep it judgment-oriented, not diagnostic-heavy
- do not duplicate the entire verify overlay

## 3. Artifacts Overlay

Purpose:

- expose retained outputs as usable inventory

### Layout

#### Header

```text
ARTIFACTS
```

#### Summary

Must show:

- retained artifact count
- optional grouped label if useful

Example:

```text
Retained outputs
3 artifacts
```

#### Evidence Sections

Order:

1. `Artifacts`
2. `Location` or `Groups` when useful

Example:

```text
Artifacts
summary.txt
notes.md
result.json

Location
project/output/
```

#### Footer Actions

```text
[q] close
```

### Artifacts Overlay Rules

- artifact names first
- compact path display only
- no trust or release reasoning here
- no governance explanation unless the artifact itself directly needs it

## 4. Timeline Overlay

Purpose:

- expose meaningful session progression

### Layout

#### Header

```text
TIMELINE
```

#### Summary

Must show:

- concise progression summary

Example:

```text
Progression
Meaningful session events in order
```

#### Evidence Sections

One main section:

1. `Timeline`

Example:

```text
Timeline
Planning started
Repository signals collected
Dependency scan executed
Artifact written: dependency-report.json
Verification stage entered
```

#### Footer Actions

```text
[q] close
```

### Timeline Overlay Rules

- strictly chronological
- no transcript chatter
- no long explanations
- no judgment blocks mixed into progression

## 5. Inspect Overlay

Purpose:

- expose the composed deep session view

### Layout

#### Header

```text
SESSION INSPECT
```

#### Summary

Must show:

- concise session state rollup

Example:

```text
Summary
Completed session with retained outputs and review-limited trust
```

#### Evidence Sections

Order:

1. `Lifecycle`
2. `Stages reached`
3. `Write governance`
4. `Artifacts`
5. `Session state`

Example:

```text
Lifecycle
completed

Stages reached
discovery -> planning -> implementation -> verification -> review

Write governance
Outcome: completed_ungated
Risk bucket: project_artifact

Artifacts
3 retained

Session state
Trust: review needed
Release: review ready
```

#### Footer Actions

```text
[q] close
```

### Inspect Overlay Rules

- this is the composite deep view
- it may summarize multiple truths, but should not replace specialized overlays
- keep evidence summarized rather than exhaustive

## 6. Approvals Overlay

Purpose:

- provide the focused decision surface for pending approvals

This complements [DAX_APPROVAL_INTERRUPTION_SPEC.md](DAX_APPROVAL_INTERRUPTION_SPEC.md), which defines when approvals interrupt the workstation.

### Layout

#### Header

```text
APPROVAL REQUEST
```

#### Summary

Must show:

- action being requested
- risk label

Example:

```text
Action
Write file: config/settings.json

Risk
Governed project write
```

#### Evidence Sections

Order:

1. `Reason`
2. `Policy expectation`
3. `Decision options`

Example:

```text
Reason
Write requires approval under policy

Policy expectation
Approval required before execution can continue

Decision options
[a] approve
[d] deny
[q] close
```

#### Footer Actions

```text
[a] approve   [d] deny   [q] close
```

### Approvals Overlay Rules

- decision surface, not raw policy explanation
- stream records the interruption moment
- sidebar records pending state
- overlay contains the actionable decision

## Cross-Overlay Consistency Rules

All overlays should share these behavior and wording constraints:

- same top-level section order
- same calm density
- same close behavior
- same preference for explanation over raw detail
- same avoidance of internal jargon where operator language exists

## Non-Goals

This document does not define:

- responsive terminal fallback behavior
- exact scroll mechanics
- raw log/debug views
- implementation-specific component hierarchy

## Success Signal

This spec is successful when:

- every overlay feels like part of one system
- operators can predict where summary vs evidence will appear
- overlays explain outcomes without overwhelming the workstation
- the evidence layer stays deep without becoming noisy
