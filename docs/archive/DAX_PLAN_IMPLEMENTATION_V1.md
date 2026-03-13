# DAX Plan Implementation V1

## 1. Goal

Expose existing planning behavior as a first-class, inspectable CLI surface.

`dax plan` v1 should let an operator define work before execution, inspect the proposed plan, and understand whether it is ready to move forward.

This is an exposure layer over the current planning substrate. It is not a new planner.

## 2. Existing Substrate

The implementation must reuse the canonical runtime behavior already present in:

- [packages/dax/src/tool/plan.ts](../packages/dax/src/tool/plan.ts)
- [packages/dax/src/session/index.ts](../packages/dax/src/session/index.ts)
- [packages/dax/src/session/prompt.ts](../packages/dax/src/session/prompt.ts)

Relevant existing behaviors:

- plan agent entry and exit
- real plan file location
- read-only planning constraints
- plan approval handoff into build mode

Implementation rule:

- CLI owns exposure
- runtime owns planning behavior

## 3. Command Contract

Canonical target:

- `packages/dax/src/cli/cmd/plan.ts`

### Input Shape

V1 input should stay narrow:

- positional intent text
- optional `--prompt` form for explicitness

Examples:

```bash
dax plan "Review repo for governance gaps"
dax plan --prompt "Generate a release-readiness checklist"
dax plan --json "Prepare migration plan for legacy CLI semantics"
```

### Flags

V1:

- `--prompt <text>` optional explicit intent input
- `--format table|json` or `--json`

Deferred:

- `--out`
- template selection
- workflow presets

### Output Modes

Human-readable mode:

- interpreted intent
- plan summary
- executable steps or recommended workflow
- readiness state
- plan file path when available

JSON mode:

- stable structured object
- session id when available
- plan path when available
- readiness field
- summary and step list

## 4. Readiness Model

V1 should expose a simple readiness state.

Recommended states:

- `ready`
- `incomplete`
- `blocked`

Suggested interpretation:

- `ready`: plan is structured and reviewable for execution
- `incomplete`: plan exists but needs refinement or missing detail
- `blocked`: plan cannot proceed without missing input or clarification

The operator must be able to answer:

`Can I run this, or do I need to refine it?`

## 5. CLI Wording Model

Use control-plane language.

Preferred wording:

- execution intent
- planning request
- plan preview
- readiness
- awaiting review
- plan file

Avoid:

- ask the assistant
- generate a response
- chat output
- brainstorm result

## 6. Implementation Notes

Implementation should stay thin.

### Reuse

- reuse the existing plan-mode and plan-file substrate
- reuse existing session creation and agent-selection paths where possible
- reuse current structured output conventions from `run` and `approvals`

### Avoid

- no second planner inside CLI
- no duplicate plan parsing logic
- no plan-specific runtime branch that bypasses existing plan agent flow

### Likely Shape

1. accept intent input
2. create or reuse a planning session
3. route into canonical planning behavior
4. collect plan preview data
5. render human-readable or JSON output

## 7. Test Plan

Cover:

- prompt/intent input path
- human-readable output contract
- JSON output contract
- readiness states
- plan-path presence when generated
- consistency with canonical planning substrate

At minimum:

- `dax plan "..."` works
- `dax plan --json "..."` emits stable structured output
- readiness appears in both output modes
- plan preview is structured, not chatty

## 8. Docs Impact

Update when implementation lands:

- `README.md`
- `docs/start-here.md`
- `docs/non-dev-quickstart.md`
- `docs/non-developer-guide.md`
- `docs/SESSIONS.md`

The key documentation rule:

- `plan` defines work
- `run` executes work

## 9. Non-Goals

- no second planner
- no explicit `validate` command
- no artifact redesign
- no approval workflow redesign
- no breaking change to `run`
- no template ecosystem yet

## 10. Acceptance Signals

### Product

- operators can inspect planned work before execution
- planning feels like part of a control plane, not a chat turn

### Architecture

- no second planner was introduced
- CLI reuses canonical planning substrate

### UX

- output is clear, structured, and non-chatty
- readiness is visible
- the relationship to `run` is obvious

### Tests

- generation path is covered
- JSON mode is stable
- readiness is covered
