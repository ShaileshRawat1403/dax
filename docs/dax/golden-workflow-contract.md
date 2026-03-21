# DAX Golden Workflow Contract v1.0

**Status:** FROZEN
**Workflow Class:** `draft_and_approve`
**Effective Date:** 2026-03-21
**Version:** 1.0.0

---

## Overview

This document defines the canonical contract for the `draft_and_approve` workflow class. This is the first D3-style deterministic workflow in DAX.

**No changes allowed without breaking-change policy.**

---

## Workflow Class

```
draft_and_approve
```

### Description

Generate artifact → approval gate → execute/commit

### Execution Mode

`approval_gated` (hardcoded for this workflow class)

### Risk Default

`medium` (adjustable via ExecutionContract)

---

## Fixed Step Graph

The workflow has exactly 3 steps in fixed order:

| Step | ID                 | Type               | Required |
| ---- | ------------------ | ------------------ | -------- |
| 1    | `prepare_draft`    | `prepare_draft`    | Yes      |
| 2    | `request_approval` | `request_approval` | Yes      |
| 3    | `commit_execution` | `commit_execution` | Yes      |

### Step 1: `prepare_draft`

**Purpose:** Generate or prepare the draft artifact for review

**Inputs:**

- `contract.intent` - the user's intent
- `contract.expectedOutputs` - expected artifact types
- `contract.toolAllowlist` - allowed tools

**Outputs:**

- `DraftArtifact` with:
  - `type`: `"file"` | `"patch"` | `"message"` | `"summary"`
  - `content`: string
  - `targetPath`: optional path hint
  - `artifactId`: optional (set after creation)

**State Transitions:**

```
(no step) → running → completed
```

**Error Handling:**

- On failure: step fails, workflow terminates with `failed` status
- Error code: `draft_failed`

---

### Step 2: `request_approval`

**Purpose:** Create approval request and pause for human decision

**Inputs:**

- `DraftArtifact` from step 1
- `contract.riskLevel` - determines approval risk level

**Outputs:**

- `Approval` object with:
  - `type`: `"file_write"` | `"patch_apply"`
  - `risk`: from contract or derived
  - `title`: `"Approve {artifact.type} execution"`
  - `reason`: `"Draft artifact requires approval before execution"`
  - `expectedConsequence`: description of what will happen

**State Transitions:**

```
running → waiting_approval (approval created)
waiting_approval → waiting_approval (awaiting resolution)
```

**Pause Behavior:**

- Execution PAUSES after approval is created
- Run status becomes `waiting_approval`
- No further steps execute until approval is resolved

**Approval Resolution Mapping:**
| Decision | Next State |
|----------|------------|
| `approved` | `running` (resume) |
| `denied` | `failed` (workflow terminates) |
| `expired` | `failed` (workflow terminates) |
| `cancelled` | `failed` (workflow terminates) |

---

### Step 3: `commit_execution`

**Purpose:** Execute the approved artifact

**Inputs:**

- `DraftArtifact` from step 1
- `Approval` resolution (must be `approved`)

**Outputs:**

- Final artifact with `artifactId`
- Run transitions to `completed`

**State Transitions:**

```
waiting_approval → running → completed
```

**Error Handling:**

- On failure: step fails, workflow terminates with `failed` status
- Error code: `execution_failed`

---

## Artifact Shapes

### DraftArtifact

```typescript
interface DraftArtifact {
  type: "file" | "patch" | "message" | "summary"
  content: string
  path?: string
  targetPath?: string
  artifactId?: string
}
```

### Final Artifact (commit_execution output)

```typescript
interface FinalArtifact {
  type: "file" | "patch" | "message" | "summary"
  content: string
  artifactId: string
  approvedAt: string
  approvedBy: string
}
```

---

## Approval Contract

### Approval Creation

When `request_approval` executes:

1. Create canonical `Approval` object
2. Persist to `ApprovalStore`
3. Link to `RunState.pendingApprovalIds`
4. Emit `approval.requested` event
5. Transition run to `waiting_approval`

### Approval Payload

```typescript
interface ApprovalPayload {
  approvalId: string
  runId: string
  stepId: string
  type: "file_write" | "patch_apply"
  risk: "low" | "medium" | "high" | "critical"
  title: string
  reason: string
  context: {
    stepId: string
    filePath?: string
  }
  expectedConsequence: string
  status: "pending"
  requestedAt: string
  source: "workflow"
}
```

### Resume Semantics

After approval resolution:

1. If `approved`: transition run to `running`, execute `commit_execution`
2. If `denied`/`expired`/`cancelled`: transition run to `failed`, workflow terminates
3. Resolution is idempotent - duplicate resolutions are rejected

---

## Terminal States

| State       | Meaning            | Allowed Transitions From Here |
| ----------- | ------------------ | ----------------------------- |
| `completed` | Workflow succeeded | None                          |
| `failed`    | Workflow failed    | None                          |
| `cancelled` | Workflow cancelled | None                          |

**Rule:** Terminal states are immutable. No transitions allowed from terminal states.

---

## Error Codes

| Code               | Step               | Meaning                 |
| ------------------ | ------------------ | ----------------------- |
| `draft_failed`     | `prepare_draft`    | Draft generation failed |
| `approval_denied`  | `request_approval` | Approval was denied     |
| `approval_expired` | `request_approval` | Approval timed out      |
| `execution_failed` | `commit_execution` | Execution failed        |

---

## Resume Contract

### Valid Resume Conditions

A run can only resume if ALL conditions are met:

1. Current status is `waiting_approval`
2. There is a pending approval
3. Approval has `approved` status
4. RunState exists for the run

### Resume Process

```
1. Verify run status == "waiting_approval"
2. Verify pending approval exists
3. Verify approval.status == "approved"
4. Transition run to "running"
5. Execute commit_execution step
6. On success: transition to "completed"
7. On failure: transition to "failed"
```

### Invalid Resume (must reject)

- Resume called when no pending approval
- Resume called when approval is denied
- Resume called when approval is expired
- Resume called from terminal state
- Resume called when no RunState exists

---

## Event Order Guarantees

For a successful workflow, the following events must occur in order:

```
1. run.created
2. run.state_changed (status: created → compiled)
3. run.state_changed (status: compiled → queued)
4. run.state_changed (status: queued → running)
5. step.proposed (prepare_draft)
6. step.started (prepare_draft)
7. step.completed (prepare_draft)
8. step.proposed (request_approval)
9. step.started (request_approval)
10. approval.requested
11. run.state_changed (status: running → waiting_approval)
12. step.completed (request_approval)
13. [PAUSE - awaiting human decision]
14. approval.resolved
15. run.state_changed (status: waiting_approval → running)
16. step.proposed (commit_execution)
17. step.started (commit_execution)
18. step.completed (commit_execution)
19. run.state_changed (status: running → completed)
```

---

## Version History

| Version | Date       | Changes                 |
| ------- | ---------- | ----------------------- |
| 1.0.0   | 2026-03-21 | Initial frozen contract |
