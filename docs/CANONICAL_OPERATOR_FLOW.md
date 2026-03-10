# Canonical Operator Flow

This document defines the canonical operator workflow for DAX as the execution control plane for AI-assisted SDLC.

The current operator grammar is:

- `dax plan`
- `dax run`
- `dax approvals`
- `dax artifacts`
- `dax audit`

This is the minimum coherent product contract for governed execution and trust review.

## 1. `plan`

Purpose:

- define work before execution
- convert intent into a structured pre-execution plan
- let the operator inspect scope and readiness before acting

What it should feel like:

- work definition
- pre-execution review
- structured planning, not chat

What it should not do:

- execute the work
- replace the runtime planner with a second planner
- become a sprawling plan-editing framework in v1

## 2. `run`

Purpose:

- execute prepared or operator-submitted work through the canonical runtime
- make execution visible before it begins
- preserve structured session continuity

What it should feel like:

- governed execution
- visible work request
- operational result, not assistant chatter

What it should not do:

- absorb all planning responsibility forever
- collapse back into generic assistant UX

## 3. `approvals`

Purpose:

- expose pending human checkpoints directly
- let operators inspect what is awaiting review
- make governance visible instead of implicit

What it should feel like:

- operator queue
- approval state
- execution checkpoint surface

What it should not do:

- hide approvals inside runtime interruption only
- read like assistant confirmation prompts

## 4. `artifacts`

Purpose:

- expose retained execution outputs directly
- reconnect outputs to session and workflow context
- let operators inspect what work products exist

What it should feel like:

- retained outputs
- inspectable work products
- output continuity after execution

What it should not do:

- become a generic file browser
- become a trust or audit surface

## 5. `audit`

Purpose:

- expose trust posture directly
- summarize approvals, overrides, evidence presence, and audit findings
- help operators decide whether the execution trail is reviewable

What it should feel like:

- trust summary
- operator review surface
- concise evidence-oriented inspection

What it should not do:

- become a raw event browser by default
- duplicate artifact inspection
- pretend to be a full verification engine in v1

## 6. Expected Flow

The canonical flow is:

1. define work with `dax plan`
2. inspect the plan and readiness
3. execute work with `dax run`
4. inspect or clear checkpoints with `dax approvals`
5. inspect retained outputs with `dax artifacts`
6. inspect trust posture with `dax audit`

This gives DAX a clear control-plane shape:

1. intent
2. plan
3. action
4. approval
5. outputs
6. trust
7. later: verification

## 7. Later Surfaces

The next natural surfaces fit after the current grammar.

### verification

Role:

- actively check integrity and readiness beyond the default trust summary
- provide stricter assurance paths when the substrate is ready

## 8. Current Scope Boundaries

Intentionally out of scope for the current phase:

- second planning engine
- explicit standalone validation command
- broad plan-editing workflow
- artifact redesign
- standalone verification engine
- breaking changes to `run`

These boundaries are deliberate. They keep the product coherent while the canonical grammar stabilizes.

## 9. Contributor Rule

Future changes should preserve this responsibility split:

- `plan` defines work
- `run` executes work
- `approvals` exposes checkpoints
- `artifacts` exposes retained outputs
- `audit` exposes trust posture

If a new feature blurs those boundaries, it should be documented and justified before implementation.
