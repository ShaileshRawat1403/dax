# DAX Execution Model

## Purpose

DAX is the execution control plane for AI-assisted work.

Its job is not to generate answers in isolation. Its job is to move work through a governed lifecycle that operators can inspect, interrupt, and trust.

The execution model is the architectural north star for DAX. Commands, TUI flows, and future APIs should all map back to this lifecycle.

## Core Lifecycle

The canonical DAX lifecycle is:

1. intent
2. plan
3. execution
4. intervention
5. output
6. trust

In operator language:

1. define the work
2. inspect the proposed work
3. execute the work
4. intervene when needed
5. inspect what was produced
6. inspect whether the execution trail is trustworthy

This is the core difference between DAX and chat-first AI tools.

## Canonical Objects

### Intent

Intent is the operator's requested work.

It is the problem statement or goal that starts the lifecycle. Intent should be clear enough to be transformed into a work object, not just passed through as free-form chat.

### Plan

A plan is an executable work object derived from intent and structured for review before execution.

A plan should answer:

- what work is proposed
- what steps are likely to happen
- whether the work is ready, incomplete, or blocked

### Session

A session is the binding layer across the DAX lifecycle.

It is the durable container for:

- intent history
- plan context
- execution continuity
- approvals and overrides
- retained outputs
- trust-relevant evidence

The session is the product unit. Commands are entry points into a session-centered model.

### Action

An action is a concrete execution step performed by the runtime.

Actions may read, write, call tools, run commands, or perform structured workflow operations. Actions belong to execution, not to planning.

### Approval

An approval is a first-class human checkpoint.

It exists when execution should pause for operator review before continuing. Approvals are not hidden interrupts. They are inspectable operational state.

### Artifact

An artifact is a retained execution output associated with a session, task, or workflow step.

Artifacts answer:

- what was produced
- what can be inspected next
- what output may be reused or handed off

Artifacts are not generic file browsing and are not the trust surface by themselves.

### Audit Posture

Audit posture is the trust-oriented summary of the execution trail.

It is derived from trust-relevant facts such as:

- approvals
- overrides
- evidence presence
- diffs
- audit findings
- release/readiness signals

Audit posture answers:

- is this execution trail reviewable?
- what trust-relevant issues remain?

## Command-to-Model Mapping

The canonical CLI grammar maps directly to the execution model.

- `dax plan`
  - exposes work definition and readiness before execution
- `dax run`
  - advances execution through the canonical runtime
- `dax approvals`
  - exposes intervention state and pending operator checkpoints
- `dax artifacts`
  - exposes retained outputs and session-linked work products
- `dax audit`
  - exposes trust posture as a summary-first operator surface

This mapping is a product contract, not just a CLI organization choice.

## Session Model

The session is where the lifecycle becomes continuous rather than command-shaped.

A session should accumulate:

- the requested intent
- the interpreted plan
- the execution narrative
- approvals and override history
- retained artifacts
- diff evidence
- trust posture updates

This means:

- commands should not create parallel sources of truth
- UI surfaces should center the session, not the command
- audit and artifact state should remain linked back to session continuity

## Evidence Model

Trust in DAX is not magic and should not rely on vague language.

The trust substrate is built from existing runtime facts:

- execution event history
- approval and override records
- retained outputs
- session diffs
- audit findings and gates

Those facts become operator trust surfaces only after they are summarized meaningfully.

This is why DAX separates:

- `artifacts`
  - what exists
- `audit`
  - why the execution trail is reviewable or needs attention

## Design Principles

### 1. No parallel logic outside the canonical runtime

CLI and TUI surfaces should expose runtime truth, not recreate it.

### 2. Surfaces answer operator questions

Every surface should exist because it answers a concrete operator question, not because a subsystem exists internally.

### 3. Work should be defined before it is executed

Planning and execution are separate responsibilities, even when convenience shortcuts exist.

### 4. Trust should summarize meaning, not raw telemetry

Raw events may remain available for experts, but default trust surfaces should expose posture and evidence, not internal noise.

### 5. Inspectability comes before opaque automation

Operators must be able to understand what is happening, what happened, and what needs review.

### 6. Human intervention is explicit

Approvals and overrides are first-class operational concepts, not hidden runtime side effects.

## Non-Goals

DAX is not:

- a chat-first assistant
- a generic file browser
- a raw log console
- an agent framework demo
- an opaque autonomous engineer

These boundaries protect the execution-control-plane identity.

## Implications For UI

The UI should reflect the execution model directly.

It should make five operator questions visible in one session-centered workspace:

- what work is this?
- what is happening now?
- what needs my decision?
- what was produced?
- can I trust this run?

That means the workstation should be built around:

- session identity
- narrated execution
- approval visibility
- artifact visibility
- audit posture

## Contributor Rule

When adding a new feature, first answer:

1. which lifecycle stage does it belong to?
2. which operator question does it answer?
3. does it extend canonical runtime behavior or duplicate it?

If that is not clear, the feature is not ready to be added.
