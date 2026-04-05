# DAX UX Contract

**The core directive: Make governance feel elegant, not heavy.**

This contract defines how DAX borrows useful UX affordances (e.g., from Claude Code) while maintaining its core identity anchored in determinism and governance.

**Rule:** DAX uses interaction surfaces and overlays as presentation and authoring patterns. The source of truth is always the deterministic execution kernel.

---

## The 4-Layer Architecture

### 1. Execution Kernel (The Source of Truth)

The non-negotiable deterministic layer.
**Owns:**

- Lifecycle state machine (RunState)
- Typed actions and tool executions
- Policy checks and budgets
- Approval objects and decisions
- Evidence receipts and artifact truth
- Replay, snapshots, and recovery
  **Constraint:** Must never be mutated by hidden or implicit UI side-effects.

### 2. Projection Layer (The View)

Where Claude-inspired UX belongs.
**Renders:**

- Role-tagged narrative transcript
- Phase progress bar
- Approval sheet/cards
- Trust ribbon (posture, score, metrics)
- Artifact drawer and diff previews
- Hook receipts and policy interventions
  **Constraint:** Must be **purely derived from kernel state**. It does not invent truth.

### 3. Interaction Layer (The Operator Controls)

The operator-facing control system.
**Includes:**

- Workflow launcher (`dax workflow run ...`)
- Quick actions and mode toggles (e.g., ELI12, Workstation layout)
- Approval resolution (Approve, Deny, Refine)
- Inspection drawer toggles
- Replay controls
  **Constraint:** Manipulates canonical runtime objects (e.g., dispatching an `approval_resolved` event). Does not bypass the state machine.

### 4. Authoring Layer (The Ergonomics)

Where Claude-style ergonomics are most valuable for developers.
**Includes:**

- Declarative workflow specs
- Role definitions
- Hook policies
- Output overlays
  **Constraint:** Must compile into kernel-compatible objects (typed steps, scopes, approval classes) _before_ execution begins.

---

## Canonical Projections

These specific UX components define the DAX interaction model and their mappings to the kernel.

### 1. Workflow Launcher

- **UX:** Command palette / slash-command interface (`dax workflow run pr-audit`).
- **Kernel Mapping:** Translates human intent into a typed `ExecutionContract` and initializes a new `RunState`.

### 2. Phase Bar

- **UX:** A compact ribbon showing lifecycle progress (Intent -> Plan -> Approval -> Execution -> Verification -> Output).
- **Kernel Mapping:** Derived from `RunState.status` and the current executing phase/step.

### 3. Role-Tagged Transcript

- **UX:** Narrative entries tagged by specialist roles (Explorer, Planner, Reviewer, Verifier).
- **Kernel Mapping:** Derived from `StepRecord` types and sub-agent invocations tracked in the RunState.

### 4. Approval Sheet

- **UX:** Dedicated surface showing what is about to happen, risk class, expected mutations, and operator options.
- **Kernel Mapping:** Projects `Permission.Request` objects from `RunState.pendingApprovalIds` and governance budgets.

### 5. Hook Receipt Cards

- **UX:** Visible notifications when a guard fires (e.g., `pre_tool_use` blocked due to out-of-scope write).
- **Kernel Mapping:** Projects runtime governance interventions and errors from `RunState.governance.failureCounts` or specific step failures.

### 6. Trust Ribbon

- **UX:** Persistent header showing audit posture, exceptions, verification status.
- **Kernel Mapping:** Derived directly from `RunState.trust` and `RunState.governance.verification`.

### 7. Artifact Drawer

- **UX:** Evidence-forward listing of files created, modified, and retained outputs.
- **Kernel Mapping:** Derived from `RunState.artifactIds`, `RunState.governance.touchedFiles`, and snapshot diffs.

### 8. Mode Overlays

- **UX:** Operator-facing projection modifiers (ELI12, Audit First, Stakeholder Summary).
- **Kernel Mapping:** These are _local TUI state_ modifiers that adjust how kernel data is rendered or formatted. They do _not_ change execution semantics.

### 9. Parallel Review Cluster

- **UX:** Compact visual cluster of multiple reviewers (status, confidence, conflicts) instead of a text dump.
- **Kernel Mapping:** Aggregation of concurrent sub-agent steps or verification plan outcomes within the RunState.

### 10. Replay Timeline

- **UX:** Scrubbable timeline of approvals, interventions, mutations, and trust transitions.
- **Kernel Mapping:** Fully backed by the event-sourced `RunEventStore` (`RunEventEnvelope` stream).

---

## State Mutation Boundaries

**What interactions are allowed to mutate state?**
Interactions are restricted to emitting strongly-typed events to the kernel's event bus or run reducer.

- Resolving an approval (`approval_resolved` event).
- Cancelling a run (`run_cancelled` event).
- Updating configuration or environment variables (explicit configuration commands).
- Submitting human feedback or refinement prompts (appends a `step_added` or updates draft).

**What is FORBIDDEN?**

- Changing risk profiles or bypassing approval requirements without a recorded policy exception.
- Modifying the filesystem without a tracked `tool_call` and corresponding artifact/mutation receipt.
- "Invisible" behavioral changes: Any shift in execution logic must leave an audit trail in the RunState.
