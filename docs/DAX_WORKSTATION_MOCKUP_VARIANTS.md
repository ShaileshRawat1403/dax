# DAX Workstation Mockup Variants

This document proposes three grounded workstation mockup directions for DAX now that the underlying runtime truths are stable enough to design around.

The goal is not to produce final UI copy.

The goal is to choose the right product posture for the workstation:

- operator-minimal
- balanced workstation
- governance-heavy

All three variants assume the same semantic foundation:

- lifecycle truth
- artifact truth
- verification and release readiness
- write governance
- session history
- timeline depth

## Shared Design Rules

All variants should preserve these rules:

### 1. Center = live execution story

The center of the workstation should answer:

- what is happening now
- what the system is doing
- what just changed
- whether the operator must intervene

The center must not become a dumping ground for governance detail.

### 2. Sidebar = persistent operator truth

The sidebar should answer:

- what is true about this session right now
- what needs attention
- whether trust or readiness changed

### 3. Overlays = depth

Detailed views should remain drilldown surfaces:

- timeline
- artifacts
- audit
- verify
- release
- deep session inspection

### 4. Stream stays clean

Do not pollute the live stream with:

- raw verification logic
- long readiness explanations
- artifact inventories
- governance evidence dumps

## Variant A: Operator-Minimal

Best when:

- speed and calmness matter most
- the user is often a solo operator
- DAX should feel lightweight despite strong semantics

### Shape

- large center stream
- very narrow sidebar
- most trust/governance depth stays behind overlays

### Default visibility

Center:

- live stream
- active step
- approval interruptions

Sidebar:

- lifecycle
- trust posture
- approvals count
- artifact count

Footer:

- drilldown shortcuts

### Mockup

```text
+----------------------------------------------------------------------------------+
| DAX — Session: repo-audit-01 | Active | Review needed | 3 artifacts | 0 waiting |
+----------------------------------------------------------------------------------+

TASK
------------------------------------------------------------------------------------
Dependency audit and release assessment for current repository

LIVE STREAM
------------------------------------------------------------------------------------
Planning workflow
Inspecting dependency manifests
Running dependency scan
Generating report artifact
Waiting for verification update

SIDEBAR
------------------------------------------------------------------------------------
Lifecycle
Active

Trust
Review needed

Approvals
0 pending

Artifacts
3 retained

FOOTER
------------------------------------------------------------------------------------
[t] timeline  [a] artifacts  [v] verify  [r] release  [i] inspect
```

### Strengths

- very calm
- keeps execution central
- low cognitive load

### Weaknesses

- trust/readiness may be too hidden
- operators may need too many drilldowns

## Variant B: Balanced Workstation

Best when:

- DAX should feel like a real execution control plane
- operators need summary truth always visible
- the system should support both active work and governed review

### Shape

- dominant center stream
- compact but information-rich right sidebar
- overlays for detail

### Default visibility

Center:

- task context
- live stream
- immediate interruptions

Sidebar:

- lifecycle
- current stage
- trust posture
- release readiness
- approvals
- artifacts
- write governance summary
- verification result

### Mockup

```text
+----------------------------------------------------------------------------------+
| DAX — Execution Control Plane                                                    |
| Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Ready: No   |
+----------------------------------------------------------------------------------+

TASK CONTEXT
------------------------------------------------------------------------------------
Dependency audit and release assessment for the current repository

LIVE STREAM
------------------------------------------------------------------------------------
Planning workflow
Collecting repository signals
Running dependency scan
Producing report artifact
Waiting for verification update

RIGHT SIDEBAR
------------------------------------------------------------------------------------
Stage
Verification

Lifecycle
Active

Trust
Review needed

Release
Review ready

Approvals
0 pending

Artifacts
3 retained

Write governance
Governed completed write

Verify
Incomplete
```

### Strengths

- best balance of execution and operator truth
- makes the control-plane identity obvious
- keeps deep detail out of the center

### Weaknesses

- more visually dense than Variant A
- requires disciplined sidebar wording

## Variant C: Governance-Heavy

Best when:

- the primary audience is regulated or review-heavy teams
- DAX must foreground trust and release posture at all times

### Shape

- center stream shares space more evenly with governance summaries
- sidebar becomes closer to a status panel
- workstation feels more like an operational review console

### Default visibility

Center:

- live stream
- current action

Sidebar:

- lifecycle
- trust posture
- release readiness
- verification result
- write governance
- audit posture
- approvals
- artifacts
- blockers summary

### Mockup

```text
+----------------------------------------------------------------------------------+
| DAX — Governance Console                                                         |
| Session: repo-audit-01 | Trust: Review needed | Release: Blocked | Verify: Fail |
+----------------------------------------------------------------------------------+

LIVE STREAM
------------------------------------------------------------------------------------
Planning workflow
Collecting repository signals
Running dependency scan
Detected ungated governed write
Release readiness degraded

RIGHT SIDEBAR
------------------------------------------------------------------------------------
Lifecycle
Completed

Trust
Review needed

Release
Blocked

Verify
Degraded

Write governance
Ungated governed write

Audit
1 blocker

Approvals
0 pending

Artifacts
3 retained
```

### Strengths

- strongest fit for review-heavy workflows
- governance issues are impossible to miss

### Weaknesses

- easiest variant to over-clutter
- most likely to pollute the live feel of the workstation
- weaker fit for everyday execution work

## Recommendation

The strongest default direction is Variant B: Balanced Workstation.

Why:

- it preserves the center-heavy execution story
- it keeps persistent session truth visible
- it does not force governance detail into the center
- it matches DAX's current product identity best:
  - execution control plane
  - governed workflow
  - drilldown-based inspection depth

Variant A is the best fallback if DAX should feel lighter and more conversational.

Variant C is useful as a reference ceiling for regulated or review-heavy modes, but it should not be the default.

## Default Exposure Proposal

If Variant B is chosen, the base workstation should expose by default:

- session title/context
- lifecycle
- trust posture
- release readiness
- current stage
- approvals count
- retained artifact count
- compact write governance summary
- verification state
- live stream

Should remain drilldown-only:

- full timeline
- artifact inventory
- verification details
- release blockers
- audit findings detail
- write-governance evidence detail
- session history deep inspection

## Next Design Discussion

After choosing a variant, the next discussion should be:

1. base workstation layout
2. stream rules
3. sidebar card wording and ordering
4. drilldown and overlay model
5. history and trust visibility boundaries

## Success Signal

The workstation direction is correct when:

- operators can track live work without distraction
- trust and readiness are visible without taking over the screen
- deeper inspection still feels one action away
- the product reads as an execution control plane, not a monitoring dashboard
