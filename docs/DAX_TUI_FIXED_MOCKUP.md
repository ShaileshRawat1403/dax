# DAX TUI Fixed Mockup

This document freezes the first user-testable DAX workstation mockup for this branch.

It is not another variant set.
It is the single working direction to test against.

## Product Rule

The workstation keeps the same hard rule:

- center = narrative
- sidebar = truth
- overlays = evidence

## Design Goal

The TUI should feel:

- modern
- minimal
- operational
- calm

It should not feel:

- like a chat transcript
- like a dashboard full of status junk
- like a compliance console

## Fixed Layout

The fixed workstation has five visible layers:

1. `Header`
2. `Task / Context`
3. `Main body`
4. `Prompt`
5. `Footer`

The main body is:

```text
LIVE STREAM | SESSION TRUTH
```

## Default Width Mockup (`120+`)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ DAX — Execution Control Plane                                                               │
│ Session: repo-audit-01 | Lifecycle: Active | Trust: Review needed | Release: Not ready     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ TASK / CONTEXT                                                                              │
│ Explore this repository and identify the runtime entry points, execution flow, and risks.   │
├───────────────────────────────────────────────────────┬──────────────────────────────────────┤
│ LIVE STREAM                                           │ SESSION TRUTH                        │
│                                                       │                                      │
│ Understanding your request                            │ Lifecycle                            │
│                                                       │ Active                               │
│ ├─ Intent interpreted                                 │                                      │
│ ├─ Plan created                                       │ Stage                                │
│ ├─ Boundary pass completed                            │ Understanding                        │
│ ├─ Entry-point pass completed                         │                                      │
│ │──────── Analysis ────────                           │ Trust                                │
│ ├─ Execution-flow pass completed                      │ Review needed                        │
│ ├─ Integrations pass completed                        │                                      │
│ ├─ Report prepared                                    │ Release                              │
│ └─ Repository summary available                       │ Not ready                            │
│    Open detail                                        │                                      │
│                                                       │ Approvals                            │
│                                                       │ 0 pending                            │
│                                                       │                                      │
│                                                       │ Artifacts                            │
│                                                       │ 1 retained                           │
│                                                       │                                      │
│                                                       │ Write governance                     │
│                                                       │ None                                 │
├───────────────────────────────────────────────────────┴──────────────────────────────────────┤
│ PROMPT                                                                                       │
│ [DAX:] /explore .                                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ [t] timeline  [a] artifacts  [v] verify  [r] release  [i] inspect  [esc] close              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Compact Width Mockup (`100–119`)

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ DAX — repo-audit-01 | Active | Review needed | Not ready                            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TASK / CONTEXT                                                                      │
│ Explore runtime entry points and execution flow.                                    │
├──────────────────────────────────────────────────────┬───────────────────────────────┤
│ LIVE STREAM                                          │ SESSION TRUTH                 │
│                                                      │                               │
│ Understanding your request                           │ Lifecycle  Active             │
│ ├─ Intent interpreted                                │ Stage      Understanding      │
│ ├─ Plan created                                      │ Trust      Review needed      │
│ ├─ Boundary pass completed                           │ Release    Not ready          │
│ ├─ Entry-point pass completed                        │ Approvals  0 pending          │
│ ├─ Execution-flow pass completed                     │ Artifacts  1 retained         │
│ └─ Report prepared                                   │ Write gov  None               │
│    Open detail                                       │                               │
├──────────────────────────────────────────────────────┴───────────────────────────────┤
│ [DAX:] _                                                                             │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [t] timeline [a] artifacts [v] verify [r] release [i] inspect                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Narrow Width Mockup (`<100`)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DAX — repo-audit-01 | Active | Review needed                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ TASK / CONTEXT                                                              │
│ Explore runtime entry points and flow.                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ STREAM                                                                      │
│                                                                              │
│ Understanding your request                                                  │
│ ├─ Intent interpreted                                                       │
│ ├─ Plan created                                                             │
│ ├─ Boundary pass completed                                                  │
│ ├─ Entry-point pass completed                                               │
│ ├─ Execution-flow pass completed                                            │
│ └─ Report prepared                                                          │
│    Open detail                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Truth: Active · Understanding · Review needed · Not ready · 0 approvals     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [DAX:] _                                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [t] timeline [a] artifacts [v] verify [r] release [i] inspect               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Overlay Example

The detail/evidence overlays remain centered and never replace the workstation.

```text
                          ┌──────────────────────────────────────┐
                          │ Repository summary                  │
                          │ esc close                           │
                          ├──────────────────────────────────────┤
                          │ What was found                      │
                          │ - runtime starts in src/index.ts    │
                          │ - session loop in src/session.ts    │
                          │ - external integrations detected    │
                          │                                     │
                          │ Reading order                       │
                          │ 1. package.json                     │
                          │ 2. src/index.ts                     │
                          │ 3. src/session.ts                   │
                          │                                     │
                          │ Evidence                            │
                          │ - package.json                      │
                          │ - src/index.ts                      │
                          │ - src/integrations.ts               │
                          └──────────────────────────────────────┘
```

## Fixed Sidebar Order

This mockup keeps the previously locked order:

1. `Lifecycle`
2. `Stage`
3. `Trust`
4. `Release`
5. `Approvals`
6. `Artifacts`
7. `Write governance`

## Fixed Stream Rules

The stream should show only:

- short execution milestones
- quiet stage dividers
- interruption lines
- short completion signals
- `Open detail` when evidence exists

The stream should not show:

- raw tool dumps
- long reasoning blocks
- release explanations
- verification summaries
- sidebar truth repeated inline

## Fixed UX Standard

If a user runs `/explore`, the workstation should let them answer these questions at a glance:

- what DAX is doing now
- what phase the run is in
- whether operator action is needed
- whether deeper evidence exists
- whether the session is in a safe, reviewable state

If those answers are visible without opening overlays, the TUI is behaving correctly.
