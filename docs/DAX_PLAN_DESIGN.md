# DAX Plan Design Pass

## 1. Command Purpose

`dax plan` should convert operator intent into a structured pre-execution plan.

Product definition:

A plan is an executable work object derived from intent, structured for review before execution.

This is not a brainstorm surface and not a loose assistant reply. It is the front door to governed work definition.

## 2. User Mental Model

`dax plan` should make DAX feel like a system that helps define work clearly before acting on it.

The operator should understand:

- `plan` defines work
- `run` executes work
- `approvals` exposes checkpoints
- `audit` and later `artifacts` reinforce trust and review

This keeps DAX aligned with the control-plane model:

- intent
- plan
- action
- approval
- verification
- evidence

## 3. Canonical Context From The Existing Runtime

Canonical DAX already contains a strong planning substrate:

- a dedicated `plan` agent in [packages/dax/src/agent/agent.ts](../packages/dax/src/agent/agent.ts)
- explicit plan-mode entry and exit tools in [packages/dax/src/tool/plan.ts](../packages/dax/src/tool/plan.ts)
- a real plan file path via [packages/dax/src/session/index.ts](../packages/dax/src/session/index.ts)
- plan-mode execution constraints and workflow guidance in [packages/dax/src/session/prompt.ts](../packages/dax/src/session/prompt.ts)

This means `dax plan` should expose and shape existing planning behavior rather than invent a parallel planning subsystem.

## 4. Input Contract

V1 should stay narrow.

Supported input:

- intent text only

Preferred CLI shapes:

```bash
dax plan "Review repo for governance gaps"
dax plan --prompt "Generate release notes from recent changes"
```

Deferred inputs:

- plan templates
- workflow presets
- artifact-derived continuation
- file-based prompt bundles

## 5. Output Contract

V1 should provide two outputs.

Default terminal output:

- a human-readable plan preview
- a readiness signal
- plan file location when a plan file is created or updated

Structured output:

- JSON plan object or plan summary
- readiness field
- session linkage
- plan file path when applicable

The operator should be able to answer:

- what work was interpreted
- what steps are proposed
- what assumptions or constraints are active
- whether the plan is ready for execution review

## 6. Readiness Contract

There is no standalone `validate` command yet.

Still, `dax plan` should surface a readiness state such as:

- `draft`
- `ready_for_review`
- `needs_input`

This keeps validation implicit while still giving operators a useful pre-execution signal.

## 7. Relationship To `run`

This should remain explicit:

- `plan` creates or previews executable work
- `run` executes prepared work
- `run --prompt` remains a convenience path during the transition

Long-term direction:

- `dax plan`
- `dax run <plan-file>` or `dax run --plan <plan-file>`

Short-term direction:

- keep prompt-driven `run` available
- do not force plan-file execution into the same wave as plan design

## 8. Canonical Behavior Map

### Input

- operator intent text

### Planning Object

- plan file in `.dax/plans/...` for project-backed repos
- plan content generated or refined through the canonical `plan` agent workflow

### Preview

- visible summary of proposed work
- scope, assumptions, and likely touched paths where available

### Readiness

- explicit pre-execution status

### JSON Contract

Suggested V1 shape:

```json
{
  "type": "plan_preview",
  "session_id": "session_123",
  "intent": "Review repo for governance gaps",
  "plan_path": ".dax/plans/1700000000000-governance-review.md",
  "readiness": "ready_for_review",
  "summary": "Review governance surfaces and identify gaps before execution.",
  "steps": [
    "Inspect governance state and approval flows",
    "Review policy and audit surfaces",
    "Summarize gaps and recommended next actions"
  ]
}
```

This is a contract direction, not an implementation commitment yet.

## 9. Acceptance Signals

`dax plan` is successful when:

- the operator can inspect proposed work before execution
- output feels structured, not chatty
- the command language reinforces DAX as a control plane
- the relationship between `plan` and `run` is obvious

## 10. Non-Goals

- no full planning framework yet
- no template marketplace
- no multi-plan orchestration
- no artifact redesign
- no forced migration away from `run --prompt` yet

## 11. Deferred Questions

- should plans be saved as files by default or only when explicitly requested?
- should `dax plan` always enter the canonical plan agent, or should there be a lightweight preview-only path?
- when should `run <plan-file>` become the primary execution path for prepared work?
- when should readiness evolve into explicit validation?

## 12. Recommended Sequence

1. Keep Wave 1 closed as complete.
2. Use this design note as the command contract for `dax plan`.
3. Inspect the current plan agent and plan file workflow for the minimum viable CLI exposure.
4. Implement `dax plan` as a narrow, inspect-first planning surface.
