# DAX Absorption Strategy

## 1. Absorption Principles

- `packages/dax` owns runtime, governance, CLI, TUI, and release behavior.
- Legacy roots donate behavior, not ownership.
- Absorb mental models and product semantics before implementation details.
- Delete only after behavior is either absorbed or intentionally rejected.
- Prefer small targeted absorptions over subtree migration.

## 2. Canonical CLI Direction

DAX should keep explicit operator nouns and execution verbs.

Preferred grammar direction:

- `dax run`
- `dax approvals`
- `dax sessions`
- `dax artifacts`
- `dax audit`
- `dax policy`

Why:

- enterprise-shaped
- operationally legible
- aligned with DAX as an execution control plane

## 3. Wave 1 Absorptions

Wave 1 establishes the operator spine:

- execution
- intervention

### Wave 1A: `run`

#### Donor Behavior

- accepts plan input or prompt input
- converts prompt input into a plan
- validates plan before execution
- runs work as an explicit execution object, not a chat turn
- returns structured execution result

#### Canonical Target

- `packages/dax/src/cli/cmd/run.ts`
- `packages/dax/src/session/*`
- current planning/prompt execution flow in canonical runtime
- quickstart and session docs

#### Canonical Fit

Canonical DAX already has a strong `run` command. The absorption target is not to replace it with the legacy shape, but to strengthen the plan-oriented mental model inside the existing command and docs.

#### Implementation Approach

1. Accept either prompt-driven execution or explicit plan/file-driven execution in the canonical run flow.
2. When prompt input is used, make the internal sequence legible:
   - intent
   - plan
   - validate
   - execute
3. Show operators what is about to run before execution proceeds.
4. Return or expose structured execution/session result for later inspection.
5. Preserve evidence trail and session linkage.

#### Docs Impact

- `README.md`
- `docs/start-here.md`
- `docs/non-dev-quickstart.md`
- `docs/build-on-dax.md`
- `docs/SESSIONS.md`

#### Test Impact

- `run <plan-file>` path
- prompt-to-plan execution path
- validation failure before execution
- structured result/session contract
- evidence/session persistence expectations

#### Acceptance Signal

`run` feels like:

`intent -> plan -> validate -> execute -> result`

not “send text to assistant”.

#### Run Tightening Checklist

Goal:
- canonical `run` must express governed execution, not assistant interaction

Required semantics:
- accept execution intent input or workflow-command input
- validate the execution request before runtime work starts
- show the operator what is about to run
- return structured, inspectable output
- preserve session and evidence continuity

Non-goals:
- no broad runtime rewrite
- no artifact redesign yet
- no audit redesign yet

### Wave 1B: `approvals`

#### Donor Behavior

- expose pending approvals as explicit operator objects
- allow operators to ask “what is waiting on me?”
- treat approvals as visible queue state, not hidden interruptions

#### Canonical Target

- new CLI command surface under `packages/dax/src/cli/cmd/approvals.ts`
- existing governance state in `packages/dax/src/governance/*`
- existing permission listing/reply API in `packages/dax/src/server/routes/permission.ts`
- TUI review/approval surface wording

#### Canonical Fit

Canonical DAX already has permission listing and reply behavior in runtime/server layers. The missing piece is an explicit operator-facing CLI surface and unified governance language.

#### Implementation Approach

Phase 1 should stay narrow:

1. Add a first-class `dax approvals` command.
2. List pending approvals with:
   - permission/tool
   - pattern or target
   - session/work item association
   - enough metadata to decide whether operator attention is needed
3. Keep action handling minimal unless runtime actions are already cleanly exposed.
4. Align CLI wording with TUI review wording.

#### Docs Impact

- governance/review docs
- `docs/non-developer-guide.md`
- operator runbooks
- release-readiness notes where approvals block progress

#### Test Impact

- no pending approvals
- one or more pending approvals
- structured output contract
- session linkage/metadata presence
- CLI and TUI wording alignment where practical

#### Acceptance Signal

An operator can explicitly inspect pending approvals without waiting to be interrupted.

## 4. Wave 2 Absorptions

Wave 2 establishes the evidence spine:

- retained outputs
- trace trust

### Wave 2A: `artifacts`

#### Donor Behavior

- outputs are retained
- outputs are inspectable later
- artifacts are part of execution, not disposable chat

#### Canonical Target

- CLI review/inspect surface, likely `packages/dax/src/cli/cmd/artifacts.ts` or equivalent inspect surface
- session and export behavior
- release and audit evidence surfaces

#### Implementation Approach

- do not just recreate a thin list command
- make artifacts part of a broader inspect/review model
- preserve artifact-to-session linkage and operational meaning

#### Docs Impact

- `docs/ARTIFACTS.md`
- `docs/release-readiness.md`
- `docs/audit-agent.md`

#### Test Impact

- artifact persistence
- artifact/session linkage
- listing/filtering behavior
- metadata integrity

#### Acceptance Signal

Artifacts are visible as execution outputs with operational meaning.

### Wave 2B: `verify-ledger`

#### Donor Behavior

- the execution trace is something DAX can verify, not only display
- trust and evidence are explicit product concerns

#### Canonical Target

- likely folded into `packages/dax/src/audit/*`
- release verification and evidence integrity flows
- not necessarily a top-level standalone command in the first move

#### Implementation Approach

- preserve the trust model
- likely express verification as:
  - `audit verify`
  - release/evidence verification
  - readiness/integrity check
- avoid reviving a standalone command unless the runtime semantics justify it

#### Docs Impact

- `docs/release-readiness.md`
- `docs/audit-agent.md`
- trust/evidence runbooks

#### Test Impact

- pass/fail integrity checks
- missing or inconsistent evidence
- verification output contract

#### Acceptance Signal

DAX supports confidence in its traces, not just storage of traces.

## 5. Last Design Checkpoint: Canonical Fit

Current canonical DAX already provides:

- rich `run` behavior in `packages/dax/src/cli/cmd/run.ts`
- session management in `packages/dax/src/cli/cmd/session.ts`
- permission list/reply API in `packages/dax/src/server/routes/permission.ts`

So the first absorptions should:

- reinforce canonical paths
- avoid side-channel legacy ownership
- add explicit operator-facing surfaces where missing

## 6. Deferred Questions

- Should artifacts remain top-level (`dax artifacts`) or move under a broader inspect grammar later?
- Should verification live under `audit`, release readiness, or a future evidence subsystem?
- How much action capability should `approvals` expose in CLI versus TUI?
- How should plan-file execution be represented in the modern `run` command without weakening the current NL-first UX?

## 7. Recommended Immediate Next Implementation Moves

1. Implement `approvals` as a canonical CLI command.
2. Tighten `run` docs and output semantics around plan-oriented execution.
3. Update TUI approval wording to match the new operator governance language.
4. Defer `artifacts` and verification until after the operator spine is clear.
