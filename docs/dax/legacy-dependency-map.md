# DAX Legacy Dependency Map

**Date:** 2026-03-21
**Purpose:** Classify DAX's current dependencies and plan migration

---

## Classification

| Category         | Status       | Description                                      |
| ---------------- | ------------ | ------------------------------------------------ |
| **Required**     | Must keep    | Core functionality cannot function without these |
| **Transitional** | Keep for now | Compatibility layer, will be deprecated          |
| **Removable**    | Can remove   | Legacy code that can be eliminated               |

---

## Required Dependencies

### 1. Session Container

**Location:** `packages/dax/src/session/`

**Why Required:**

- Session is the runtime container for message storage
- Tool execution happens within session context
- Message history is stored in session

**Future Direction:**

- Session remains as execution context
- But RunState becomes authoritative for status
- Session messages become execution trace, not truth

**Migration:**

- No removal planned
- Role changes from truth source to trace source

---

### 2. Message Storage

**Location:** `packages/dax/src/session/message*.ts`

**Why Required:**

- Stores conversation history
- Tool call/result pairs persist here
- Context for model inference

**Future Direction:**

- Keep for context/inference
- Remove from status derivation path

---

### 3. Tool Registry

**Location:** `packages/dax/src/tool/registry.ts`

**Why Required:**

- Resolves available tools
- Enforces allowlist from ExecutionContract

**Migration:**

- No removal
- Will integrate with contract-based allowlist

---

### 4. Permission System (Partial)

**Location:** `packages/dax/src/governance/`

**Why Required:**

- Runtime tool access control
- User preference storage

**Future Direction:**

- Keep runtime enforcement
- Deprecate as approval truth source

---

## Transitional Dependencies

### 1. Lifecycle Inference

**Location:** `packages/dax/src/session/lifecycle.ts`

**Status:** Transitional

**Why:**

- Currently used to derive run status
- Will be replaced by RunState as primary

**Migration Path:**

```
1. RunState created for all new runs (DONE)
2. Lifecycle becomes reconciliation only (IN PROGRESS)
3. Legacy path deprecated once coverage complete
4. Lifecycle inference removed from hot path
```

**Checkpoints:**

- [x] RunState created on run creation
- [x] RunState preferred in getSnapshot
- [ ] Lifecycle inference only used for reconciliation
- [ ] Legacy path returns error/warning
- [ ] Legacy path removed

---

### 2. Permission-to-Approval Bridge

**Location:** `packages/dax/src/runtime/compat/permission-adapter.ts`

**Status:** Transitional

**Why:**

- Permission asks are adapted to canonical approvals
- Allows legacy permission flow to work with new approval model

**Migration Path:**

```
1. Keep adapter for compatibility (DONE)
2. Workflow-gated runs use native approvals
3. Legacy permission runs use adapter
4. Gradually increase native approval usage
5. Adapter becomes optional/dev-only
```

**Checkpoints:**

- [x] Permission adapter exists
- [ ] Native approval creation for fixed workflows
- [ ] Legacy permission-only runs use adapter
- [ ] Adapter marked as deprecated
- [ ] Adapter removed or made optional

---

### 3. Legacy Session Prompt

**Location:** `packages/dax/src/session/prompt.ts`

**Status:** Transitional

**Why:**

- Currently starts execution for non-fixed workflows
- Passes intent directly to model

**Migration Path:**

```
1. Fixed workflows use new path (DONE)
2. Non-fixed workflows still use SessionPrompt
3. Compile non-fixed workflows to ExecutionContract
4. All runs eventually use contract-driven execution
```

**Checkpoints:**

- [x] Fixed workflows use new execution path
- [ ] Non-fixed workflows compile to contract
- [ ] SessionPrompt receives contract context
- [ ] Raw intent-only path deprecated

---

### 4. Session-Based Status Derivation

**Location:** `packages/dax/src/server/run-gateway.ts` (fallback path)

**Status:** Transitional

**Why:**

- getSnapshot falls back to session-derived status when no RunState

**Migration Path:**

```
1. All runs create RunState (DONE)
2. getSnapshot prefers RunState (DONE)
3. Fallback path logs warning
4. Fallback removed after migration period
```

**Checkpoints:**

- [x] All new runs create RunState
- [x] getSnapshot checks RunState first
- [ ] Fallback logs warning
- [ ] Fallback removed

---

## Removable Dependencies

### 1. Post-Hoc Trust Synthesis

**Location:** `packages/dax/src/governance/trust*.ts`

**Status:** Removable (can be replaced)

**Why:**

- Trust is currently synthesized from signals after execution
- Not deterministic

**Future Direction:**

- Execution-gating trust model
- Trust derived from contract + runtime signals

**Migration:**

- Deprecate post-hoc synthesis
- Implement pre-execution trust assessment from contract

---

### 2. Message Archaeology in getSnapshot

**Location:** `packages/dax/src/server/run-gateway.ts`

**Status:** Removable

**Why:**

- currentStepFromMessages derives step from message parts
- Will be replaced by RunState.steps

**Migration:**

- Remove currentStepFromMessages once RunState is fully adopted
- Keep for backward compatibility during transition

---

## Migration Checklist

### Phase 1: RunState Primary (DONE)

- [x] RunState created on run creation
- [x] RunState persisted before execution
- [x] getSnapshot checks RunState first
- [x] Lifecycle inference becomes reconciliation only

### Phase 2: Approval Canonical (DONE)

- [x] Approvals persisted as first-class objects
- [x] ApprovalStore created
- [x] getApprovals reads canonical approvals first
- [x] Permission adapter bridges legacy

### Phase 3: Workflow Native

- [x] Fixed workflows use new execution path
- [ ] Non-fixed workflows compile to contract
- [ ] Workflow registry expanded
- [ ] SessionPrompt receives contract context

### Phase 4: Legacy Cleanup (IN PROGRESS)

- [x] Fallback path logs warning
- [x] Authority counters track distribution
- [ ] Lifecycle inference removed from hot path (planned for future)
- [ ] currentStepFromMessages removed (planned for future)
- [ ] Permission adapter marked deprecated (planned for future)

---

## Summary

| Category     | Count | Status      |
| ------------ | ----- | ----------- |
| Required     | 4     | Stable      |
| Transitional | 4     | In progress |
| Removable    | 2     | Planned     |

**Current Focus:** Transitional dependencies (Phases 3-4)

**Next Milestone:** All runs use RunState as primary truth with no fallback
