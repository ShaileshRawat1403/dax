# DAX Execution Determinism Spec v1

## Purpose

This document defines what "deterministic" means in DAX, what guarantees DAX provides at each level, which parts remain probabilistic, and what objects are canonical.

---

## Guarantee Levels

### D0: Inspectable Only

**Definition:** Output is produced and logged. No guarantees about structure, correctness, or repeatability.

**What this covers:**

- Raw LLM completions
- Freeform text generation
- Exploratory analysis without defined outputs

**DAX responsibility:** Log everything. Surface signals for trust evaluation.

**Not deterministic because:** Same input may produce different outputs. No contract on format or behavior.

---

### D1: Bounded Tool Execution

**Definition:** Execution uses an allowlisted set of tools with metered resources. The system cannot perform arbitrary actions outside its bounds.

**What this covers:**

- Tool access controlled by `ExecutionContract.toolAllowlist`
- Resource limits enforced (token budgets, step limits, timeouts)
- No arbitrary code execution outside defined tools
- File access scoped to working directory or explicit paths

**DAX responsibility:** Enforce allowlists at tool resolution. Reject out-of-bounds calls. Meter resource usage.

**Deterministic because:** Tool surface is fixed. Resource bounds are explicit. Same contract guarantees same available actions.

**Still probabilistic because:** Tool implementation may vary. Model may choose different tools in same allowlist. Output format not strictly constrained.

---

### D2: Approval-Gated Deterministic Transitions

**Definition:** State transitions pause at explicit approval points. Human decision is required before continuation. Transitions are logged and auditable.

**What this covers:**

- Explicit pause points defined in workflow or triggered by risk level
- Approval objects with context, risk, expected consequence
- Resolution (approve/deny) gates continuation
- All transitions logged with actor, reason, timestamp

**DAX responsibility:**

- Emit `approval.requested` before gated transitions
- Persist `Approval` object with full context
- Enforce gate: execution cannot proceed without resolution
- Log resolution with actor and reason

**Deterministic because:** Transitions are explicit. No silent continuation past approval points. Same approval resolution + same state → same next state.

**Still probabilistic because:** Human decision introduces variability. Approval context may be incomplete. Model behavior after approval may vary.

---

### D3: Compiled Workflow with Replayable State Transitions

**Definition:** Execution follows a pre-defined workflow class with a fixed step graph. Full replay is possible. Deterministic outputs given same inputs and same approval resolutions.

**What this covers:**

- Workflow class defines fixed or constrained step graph
- `ExecutionContract` is compiled before execution starts
- Step sequence is authored, not model-invented
- State transitions are explicit function calls, not inferred
- Event log enables full replay and recovery
- Idempotency: same contract + same inputs → recoverable state graph

**DAX responsibility:**

- Compile `ExecutionContract` from intent before execution
- Initialize `RunState` with authored step graph
- Execute through `transitionTo()` functions only
- Emit events for every transition
- Support replay from event log
- Reject illegal transitions

**Deterministic because:**

- Step graph is fixed or constrained
- Transitions are explicit and logged
- Approval resolutions are persisted
- Replay rebuilds state correctly
- Same inputs + same resolutions → same outputs

**Still probabilistic because:** Some steps may have model-dependent sub-actions within fixed bounds. External tool outputs may vary. Human decisions in approvals introduce variability.

---

## What Is Deterministic in DAX Today

| Component             | Current Level | Gap                                             |
| --------------------- | ------------- | ----------------------------------------------- |
| Tool allowlists       | D1            | Partially enforced via plugin registry          |
| Resource metering     | D1            | Step limits exist, token budgets partial        |
| Approval pause points | D2            | Partial - inferred from permission intercepts   |
| Approval persistence  | D2            | Merged from permissions + events, not canonical |
| Run state transitions | D2→D3         | Derived from messages, not authored             |
| Workflow compilation  | D0            | Intent → prompt, not intent → contract          |
| Event replay          | D2            | Events stored, replay logic partial             |
| Step graph            | D0            | Model invents steps from messages               |

---

## What Is Probabilistic in DAX Today

| Component                       | Reason                     | Mitigation                              |
| ------------------------------- | -------------------------- | --------------------------------------- |
| Model output format             | LLM variability            | Execution Contract constrains structure |
| Tool selection within allowlist | Model discretion           | Workflow classes constrain choices      |
| Approval context quality        | Depends on session signals | Canonical context object required       |
| Trust summary accuracy          | Post-hoc synthesis         | Execution-gating trust model needed     |
| Step sequence                   | Freeform model execution   | Fixed workflow classes required         |

---

## Canonical Objects

These objects are the authoritative sources of truth in DAX:

### ExecutionContract

```typescript
interface ExecutionContract {
  contractId: string
  taskClass: WorkflowClass
  intent: string
  riskLevel: RiskLevel
  executionMode: "auto" | "approval_gated" | "manual"
  toolAllowlist: string[]
  toolBlocklist: string[]
  approvalPolicy: ApprovalPolicy
  expectedOutputs: OutputContract[]
  retryPolicy: RetryPolicy
  timeoutMs: number
  fallbackPolicy?: FallbackPolicy
  createdAt: string
}
```

**Purpose:** Compiled task definition. Authored before execution starts. Immutable for run lifetime.

**Canonical status:** Primary truth. Created from intent. Governs entire execution.

---

### RunState

```typescript
interface RunState {
  runId: string
  contractId: string
  status: RunStatus
  currentStepId: string | null
  steps: StepRecord[]
  approvals: ApprovalRecord[]
  artifacts: ArtifactRecord[]
  events: RunEvent[]
  trust: TrustSummary
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

**Purpose:** Authoritative persisted state. Updated via explicit transitions only.

**Canonical status:** Primary truth for runtime state. Replaces session-derived lifecycle.

---

### Approval

```typescript
interface Approval {
  approvalId: string
  runId: string
  stepId: string
  type: ApprovalType
  risk: RiskLevel
  title: string
  reason: string
  context: ApprovalContext
  expectedConsequence: string
  status: ApprovalStatus
  requestedAt: string
  resolvedAt?: string
  actor?: string
  source: "workflow" | "permission"
  resolution?: ApprovalResolution
}
```

**Purpose:** First-class approval object. Not just permission interruption.

**Canonical status:** Primary truth for approval state. Replaces permission-as-approval model.

---

### StepRecord

```typescript
interface StepRecord {
  stepId: string
  title: string
  status: StepStatus
  startedAt?: string
  completedAt?: string
  blockedReason?: string
  outputs: ArtifactRecord[]
}
```

**Purpose:** Authored or compiled step in workflow. Tracked explicitly.

**Canonical status:** Primary truth for step progress. Replaces currentStepFromMessages inference.

---

### RunEvent

```typescript
interface RunEvent {
  eventId: string
  runId: string
  type: EventType
  payload: Record<string, any>
  timestamp: string
  sequence: number
  cursor: string
}
```

**Purpose:** Append-only log of all state transitions. Enables replay and recovery.

**Canonical status:** Source of truth for audit and replay. Primary input for reconciliation.

---

## State Transition Model

### Authoritative Transitions

All state changes happen through explicit transition functions:

```typescript
transitionTo(runId: string, newStatus: RunStatus, reason: string): void
advanceStep(runId: string, stepId: string): void
requestApproval(runId: string, approval: Approval): void
resolveApproval(runId: string, approvalId: string, resolution: ApprovalResolution): void
completeStep(runId: string, stepId: string, outputs: ArtifactRecord[]): void
failRun(runId: string, reason: string): void
```

### Illegal Transition Rejection

Transitions must follow the state machine. Illegal transitions throw:

```
created → queued → running → waiting_approval → running → completed/failed/cancelled
```

Rejecting:

- `completed → running`
- `cancelled → running`
- `failed → waiting_approval`

### Event Emission

Every transition emits a corresponding event:

| Transition                   | Event                |
| ---------------------------- | -------------------- |
| `created → queued`           | `run.queued`         |
| `queued → running`           | `run.started`        |
| `running → waiting_approval` | `approval.requested` |
| `waiting_approval → running` | `approval.resolved`  |
| `running → completed`        | `run.completed`      |
| `running → failed`           | `run.failed`         |
| `* → cancelled`              | `run.cancelled`      |

---

## Determinism Test Harness

Location: `packages/dax/test/determinism/`

### Required Tests

#### 1. Contract Compilation Determinism

```typescript
test("same intent compiles to same contract") {
  const intent = "analyze repo and summarize findings"
  const contract1 = compile(intent)
  const contract2 = compile(intent)
  expect(contract1).toEqual(contract2)
}
```

#### 2. State Transition Determinism

```typescript
test("same transitions produce same state") {
  const run = createRun(contract)
  transitionTo(run.id, "running", "user started")
  advanceStep(run.id, "step-1")
  completeStep(run.id, "step-1", [artifact])
  const snapshot1 = getSnapshot(run.id)

  // Replay events
  const replayed = replayFromEvents(run.id, run.events)
  const snapshot2 = getSnapshot(run.id)

  expect(snapshot1).toEqual(snapshot2)
}
```

#### 3. Approval Idempotency

```typescript
test("duplicate approval resolution is idempotent") {
  const run = createRun(contract)
  requestApproval(run.id, approval)
  resolveApproval(run.id, approval.id, { decision: "approved", actor: "user" })

  // Second resolution attempt
  resolveApproval(run.id, approval.id, { decision: "approved", actor: "user" })

  // State unchanged
  const snapshot = getSnapshot(run.id)
  expect(snapshot.approvals[0].status).toBe("approved")
}
```

#### 4. Replay Recovery

```typescript
test("interrupted run recovers from event log") {
  const run = createRun(contract)
  advanceStep(run.id, "step-1")
  // Simulate interruption here
  const recovered = recoverRun(run.id)
  expect(recovered.currentStepId).toBe("step-1")
}
```

#### 5. Illegal Transition Rejection

```typescript
test("illegal transition is rejected") {
  const run = createRun(contract)
  transitionTo(run.id, "completed", "done")

  expect(() => {
    transitionTo(run.id, "running", "resume")
  }).toThrow("illegal transition")
}
```

#### 6. Event Order Stability

```typescript
test("events are stored in stable sequential order") {
  const run = createRun(contract)
  // Generate events
  const events = getEvents(run.id)

  for (let i = 1; i < events.length; i++) {
    expect(events[i].sequence).toBeGreaterThan(events[i-1].sequence)
    expect(events[i].cursor).toBeGreaterThan(events[i-1].cursor)
  }
}
```

---

## Implementation Checklist

### Phase 2: Execution Contract

- [ ] `execution-contract.ts` type definitions
- [ ] `compiler.ts` intent → contract compilation
- [ ] `run-factory.ts` contract → run initialization
- [ ] Tool allowlist enforcement at resolution
- [ ] Contract immutability for run lifetime

### Phase 3: Run State Machine

- [ ] `run-state.ts` authoritative state model
- [ ] `run-store.ts` persisted state storage
- [ ] `transitions.ts` explicit transition functions
- [ ] Illegal transition rejection
- [ ] Event emission on every transition
- [ ] `session-adapter.ts` compatibility wrapper
- [ ] `lifecycle-reconciler.ts` edge case handling

### Phase 4: Canonical Approval Model

- [ ] `approval-store.ts` first-class approval persistence
- [ ] `approval-transitions.ts` approval state machine
- [ ] `permission-adapter.ts` permission → approval bridge
- [ ] Approval context object with consequence
- [ ] Idempotent resolution

### Phase 5: Golden Workflow

- [ ] `draft_and_approve` workflow class
- [ ] Fixed step graph: `prepare_draft` → `request_approval` → `commit_execution`
- [ ] Determinism tests
- [ ] Replay tests
- [ ] Recovery tests

---

## Glossary

| Term           | Definition                                            |
| -------------- | ----------------------------------------------------- |
| Deterministic  | Same inputs produce same outputs or recoverable state |
| Bounded        | Tools and resources are explicitly constrained        |
| Authored       | Execution follows compiled contract, not freeform     |
| Replayable     | Event log enables full state reconstruction           |
| Transition     | Explicit state change via `transitionTo()`            |
| Reconciliation | Merging session signals into authoritative state      |
| Compilation    | Intent → ExecutionContract transformation             |

---

## Version History

| Version | Date       | Changes      |
| ------- | ---------- | ------------ |
| 1.0     | 2026-03-21 | Initial spec |
