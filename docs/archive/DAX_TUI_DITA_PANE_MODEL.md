# DAX TUI DITA Pane Model

## Purpose

This document applies a DITA-informed information architecture to the DAX TUI.

DITA is not used here as user-facing vocabulary. It is used as a structural filter for deciding what kind of information belongs in each workspace area.

This helps prevent the TUI from becoming a mixed surface of explanation, action, state, and recovery all at once.

## Why DITA Fits DAX

DAX needs a disciplined way to separate:

- operator orientation
- workflow action
- inspectable system truth
- recovery and intervention

The DITA axis gives that structure:

- concept
- task
- reference
- troubleshooting

For DAX, this maps naturally onto the governed execution workstation.

## DITA Axis For DAX

### 1. Concept

Question answered:

- what is this work?

This is the orientation layer.

It should contain:

- session purpose
- workflow goal
- planned steps
- current lifecycle phase

### 2. Task

Question answered:

- what can the operator do now?

This is the action layer.

It should contain:

- workflow progression
- next recommended action
- approval actions
- inspect/open actions

### 3. Reference

Question answered:

- what facts and outputs are available?

This is the inspectable system-truth layer.

It should contain:

- approvals summary
- artifacts
- audit posture
- evidence indicators
- output metadata

### 4. Troubleshooting

Question answered:

- what is blocked, failed, or needs recovery?

This is the interruption and recovery layer.

It should contain:

- approval-required blockers
- policy denials
- failures
- missing evidence
- audit gate issues

## Pane Mapping

The DAX workstation should map panes to DITA roles like this.

| TUI area | DITA role | Purpose |
| --- | --- | --- |
| Session header | Concept + Troubleshooting | orient the operator and show blockers |
| Plan pane | Concept | explain intended work |
| Transcript | Task | narrate workflow progression |
| Footer / action bar | Task | show available actions |
| Approvals panel | Reference | show pending checkpoints |
| Artifacts panel | Reference | show retained outputs |
| Audit panel | Reference | show trust posture |
| Alerts / dialogs | Troubleshooting | handle interruption and recovery |

## Editorial Rules By Area

### Header

Primary role:

- concept

Secondary role:

- troubleshooting

The header should show:

- session identity
- current phase
- state
- blocker summary if present

It should not show deep reference detail.

### Plan Pane

Role:

- concept

The plan pane should stabilize operator understanding.

It should show:

- what the work is
- what steps are intended
- which step is current

It should not become a dump of runtime internals.

### Transcript

Role:

- task

The transcript should narrate workflow progression.

It should show:

- planning workflow
- validating steps
- executing step
- awaiting approval
- artifact produced
- audit posture updated

It should not default to raw telemetry or model-thinking narration.

### Footer / Command Bar

Role:

- task

The footer should tell the operator what can be done now.

Examples:

- approve
- deny
- open artifact
- open audit detail

### Approvals Panel

Role:

- reference

It should show inspectable facts about pending decisions:

- requested operation
- reason
- session linkage

It should not become the only location where the operator notices a blocker. Blocker posture also belongs in troubleshooting.

### Artifacts Panel

Role:

- reference

It should show:

- what outputs exist
- where they came from
- what can be inspected next

### Audit Panel

Role:

- reference

It should show:

- trust posture
- findings posture
- evidence presence
- approvals / overrides summary

It should summarize meaning, not dump raw events by default.

### Alerts and Dialogs

Role:

- troubleshooting

These should only activate for:

- approvals
- failures
- policy denials
- severe trust or gate issues

This keeps interruption reserved for real intervention.

## Interaction Priority

DITA also helps define interaction priority.

### Low interruption

- concept
- reference

These should usually be visible and calm.

### Medium interruption

- task

These should guide action without blocking.

### High interruption

- troubleshooting

These should interrupt only when action or recovery is required.

## Design Rule

Do not expose DITA terms directly in the product.

Users should not see tabs named:

- Concept
- Task
- Reference
- Troubleshooting

They should see DAX-native labels:

- Plan
- Activity
- Approvals
- Artifacts
- Audit
- Alerts

DITA is the design grammar underneath those labels.

## Why This Is Better Than Dashboard Thinking

A dashboard mindset asks:

- what widgets should be visible?

A DITA-informed workstation asks:

- what kind of information is this?
- what operator question does it answer?
- should it orient, instruct, report, or help recover?

That discipline is more useful for DAX than a generic dashboard approach.

## Success Criteria

The DITA pane model is working when:

- each pane has one clear editorial role
- the transcript is task-oriented rather than telemetry-heavy
- trust and outputs remain inspectable without taking over the center
- interruptions are rare and meaningful
- the workstation feels like governed execution, not terminal chat
