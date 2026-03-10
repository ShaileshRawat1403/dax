# DAX Workstation Refined Mockup

This document defines the single refined workstation direction for DAX after the layout, sidebar, stream, overlay, and interaction layers have been separately clarified.

The chosen direction is:

- balanced workstation

The goal is to stop comparing variants and commit to one coherent operator environment.

## Product Direction

DAX should feel like:

- an execution workstation
- with persistent governed truth
- and deep evidence one action away

It should not feel like:

- a monitoring dashboard
- a compliance report
- a chat transcript with side widgets

## Core Workstation Invariant

The workstation is organized by role:

- center = narrative
- sidebar = truth
- overlays = evidence

This is now a hard architectural rule, not a stylistic preference.

## High-Level Layout

The refined balanced workstation has four permanent regions:

1. header
2. task/context band
3. center live stream
4. right sidebar

And one transient region:

5. overlays

The footer is always present, but changes hints based on whether the base workstation or an overlay owns focus.

## Header

Purpose:

- lightweight session identity and global state

Should show:

- product name
- session label or title
- compact lifecycle summary
- compact trust summary
- compact release summary

Should not show:

- detailed verification state
- artifact counts
- write-governance reasoning

Example:

```text
+--------------------------------------------------------------------------------------------------+
| DAX — Execution Control Plane                                                                    |
| Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Release: Not ready          |
+--------------------------------------------------------------------------------------------------+
```

Why:

- the header should orient, not become a second sidebar

## Task / Context Band

Purpose:

- hold the current task or mission context above the stream

Should show:

- concise task framing
- current scope or objective

Should not show:

- live status updates
- deep evidence or reasoning

Example:

```text
TASK / CONTEXT
----------------------------------------------------------------------------------------------------
Dependency audit and release assessment for current repository
```

Why:

- context should remain visible while the stream evolves
- task context should not be pushed into the stream itself

## Center: Live Stream

Purpose:

- show the unfolding execution story

Allowed content:

- execution steps
- progress transitions
- interruptions
- short outcome events

Forbidden content:

- verification reasoning
- readiness explanations
- artifact inventories
- policy or audit detail

Example:

```text
LIVE STREAM
----------------------------------------------------------------------------------------------------
Planning workflow
Collecting repository signals
Running dependency scan
Producing report artifact
Waiting for verification update
```

Why:

- the operator should always be able to answer "what is happening now?" from the center alone

## Right Sidebar

Purpose:

- show durable session truth that remains visible while work continues

Fixed card order:

1. `Lifecycle`
2. `Stage`
3. `Trust`
4. `Release`
5. `Approvals`
6. `Artifacts`
7. `Write governance`

Refined sidebar mockup:

```text
RIGHT SIDEBAR
----------------------------------------------------------------------------------------------------
Lifecycle
Active

Stage
Verification

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
```

Sidebar rules:

- each card exposes one durable fact
- only simple state emphasis:
  - normal
  - warning
  - critical
  - success
- no long explanations inside cards

## Footer

Purpose:

- expose the evidence shortcuts and close/return behavior

Base workstation footer:

```text
FOOTER
----------------------------------------------------------------------------------------------------
[t] timeline   [a] artifacts   [v] verify   [r] release   [i] inspect   [q] close
```

Footer rules:

- base workstation shows evidence shortcuts
- overlay footer should switch to overlay-relevant hints only
- footer should reflect the current interaction layer

## Overlays

Overlays are the evidence layer.

Primary overlays:

- `verify`
- `release`
- `artifacts`
- `timeline`
- `inspect`

Entry points:

- `Trust` -> verify
- `Release` -> release
- `Artifacts` -> artifacts
- `Write governance` -> inspect
- `Approvals` -> approvals overlay when pending
- `t` -> timeline
- `i` -> inspect

Overlay rules:

- one overlay at a time
- overlay takes focus
- close returns to prior focus
- overlays explain; they do not replace the stream

## Full Refined Mockup

```text
+--------------------------------------------------------------------------------------------------+
| DAX — Execution Control Plane                                                                    |
| Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Release: Not ready          |
+--------------------------------------------------------------------------------------------------+

TASK / CONTEXT
----------------------------------------------------------------------------------------------------
Dependency audit and release assessment for current repository

LIVE STREAM
----------------------------------------------------------------------------------------------------
Planning workflow
Collecting repository signals
Running dependency scan
Producing report artifact
Waiting for verification update

RIGHT SIDEBAR
----------------------------------------------------------------------------------------------------
Lifecycle
Active

Stage
Verification

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

FOOTER
----------------------------------------------------------------------------------------------------
[t] timeline   [a] artifacts   [v] verify   [r] release   [i] inspect   [q] close
```

## Why This Direction Wins

This mockup works because:

- the center remains execution-first
- the sidebar remains truth-first
- evidence remains one action away
- governance is visible without dominating the screen

It reflects the product accurately:

- DAX is not only a coding stream
- DAX is not only a governance dashboard
- DAX is an execution control plane

## Things Intentionally Deferred

This refined mockup does not yet settle:

- detailed overlay layouts
- exact footer hint changes per overlay
- approval interruption styling
- transcript/stream typography
- responsive terminal width behavior

Those should follow from this spec, not precede it.

## Next Design Questions

After this refined mockup, the next useful questions are:

1. overlay behavior and layout details
2. footer and shortcut refinement by focus state
3. approval interruption presentation
4. responsive layout constraints for narrower terminals

## Success Signal

This workstation direction is correct when:

- an operator can understand the current session in one glance
- the center never turns into a policy dashboard
- the sidebar never turns into a reasoning feed
- evidence is always one action away
- the workstation feels cohesive enough to implement directly
