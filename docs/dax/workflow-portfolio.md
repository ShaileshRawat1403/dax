# DAX v1 Workflow Portfolio

**Status**: Frozen for v1
**Last Updated**: 2026-03-21

## Overview

DAX v1 provides a deterministic workflow suite with three fixed workflow classes. Each workflow has a locked step graph, predictable execution paths, and standardized output shapes.

---

## Workflow Comparison Matrix

| Property             | `draft_and_approve`  | `repo_analyze`           | `review_and_signoff`       |
| -------------------- | -------------------- | ------------------------ | -------------------------- |
| **Steps**            | 3                    | 3                        | 4                          |
| **Step Graph**       | Linear               | Linear                   | Linear                     |
| **Risk Mode**        | Controlled Mutation  | Read-only                | Read-only with Signoff     |
| **Approval Mode**    | Manual               | None                     | Manual Signoff             |
| **Trust Posture**    | Medium               | High                     | Medium                     |
| **Allowed Tools**    | Project-specific     | Read-only only           | Read-only only             |
| **Blocked Tools**    | N/A                  | write, edit, bash, shell | write, edit, bash, shell   |
| **Terminal States**  | completed, failed    | completed, failed        | completed, failed, expired |
| **Success Criteria** | Execution successful | Analysis complete        | Signoff received           |
| **Artifact Type**    | file, patch          | report                   | report, outcome            |

---

## Workflow Details

### `draft_and_approve`

**Purpose**: Controlled mutation with human approval gate

**Step Graph**:

```
prepare_draft → request_approval → commit_execution
```

**Terminal Reasons**:

- `workflow_completed` - Execution successful
- `workflow_failed` - Execution failed
- `permission_denied` - Approval denied
- `timeout` - Approval timed out

**Trust Posture**: Medium

- Requires explicit human approval before mutation
- Blocked tools determined by contract

**Use Cases**:

- Code generation with review
- Automated refactoring
- Batch changes requiring sign-off

---

### `repo_analyze`

**Purpose**: Deterministic read-only analysis

**Step Graph**:

```
collect_context → analyze_repository → publish_report
```

**Terminal Reasons**:

- `workflow_completed` - Analysis successful
- `workflow_failed` - Analysis failed

**Trust Posture**: High

- Read-only operations only
- No mutation of any kind
- No approval required

**Allowed Tools**: `read`, `glob`, `grep`

**Blocked Tools**: `write`, `edit`, `bash`, `shell`, `apply_patch`, `apply_file`

**Use Cases**:

- Repository structure analysis
- Code quality assessment
- Dependency auditing
- Pattern detection

---

### `review_and_signoff`

**Purpose**: Professional decision workflow with signoff

**Step Graph**:

```
collect_context → produce_review → request_signoff → finalize_outcome
```

**Terminal Reasons**:

- `workflow_signed_off` - Approved and signed
- `workflow_rejected` - Rejected
- `workflow_expired` - Signoff timed out
- `workflow_failed` - Step execution failed

**Trust Posture**: Medium

- Read-only analysis
- Explicit signoff required
- Timeout handling for signoff

**Allowed Tools**: `read`, `glob`, `grep`

**Blocked Tools**: `write`, `edit`, `bash`, `shell`, `apply_patch`, `apply_file`

**Use Cases**:

- Security review
- Architecture review
- Compliance review
- Design review

---

## Terminal State Definitions

### Completed States

| Workflow             | Success Terminal | Description                    |
| -------------------- | ---------------- | ------------------------------ |
| `draft_and_approve`  | `completed`      | Draft executed successfully    |
| `repo_analyze`       | `completed`      | Analysis completed             |
| `review_and_signoff` | `completed`      | Signoff received and finalized |

### Failure States

| Workflow             | Failure Terminal    | Description       |
| -------------------- | ------------------- | ----------------- |
| All                  | `failed`            | Execution failed  |
| All                  | `cancelled`         | Run cancelled     |
| `draft_and_approve`  | `permission_denied` | Approval denied   |
| `review_and_signoff` | `expired`           | Signoff timed out |

---

## Artifact Output Schema

All workflows produce standardized artifacts:

### Final Artifact Structure

```typescript
interface WorkflowFinalArtifact {
  type: "file" | "patch" | "report" | "outcome" | "message"
  content: string
  metadata: {
    workflowClass: WorkflowClass
    runId: string
    terminalReason: WorkflowTerminalReason
    completedAt: string
  }
}
```

### Report Artifact Structure (repo_analyze, review_and_signoff)

```markdown
# [Title]

## Intent

[Original request]

## Summary

[Key findings]

## Findings

[Detailed findings]

## Recommendations

[Action items]

## Metadata

- Workflow: [workflow_class]
- Run ID: [run_id]
- Completed: [timestamp]
```

---

## Trust Posture Explanations

### High (repo_analyze)

- Pure read-only operations
- No potential for harm
- No human intervention needed
- Deterministic output

### Medium (draft_and_approve, review_and_signoff)

- Controlled mutation or signoff required
- Human approval gate before sensitive operations
- Risk managed through contract

### Low

- Not used in v1
- Reserved for future fully-autonomous workflows

### Minimal

- Not used in v1
- Reserved for admin/system workflows

---

## External Surface Support

### Soothsayer Integration

- All workflows support `soothsayer` source
- Authority: `dax-state-machine`
- Full observability via telemetry

### Picobot Ingress

- Workflow selection via intent classification
- Contract-based execution
- Standardized artifact outputs

---

## Telemetry Metrics

### Workflow Frequency

- `workflow.{class}.started`
- `workflow.{class}.completed`
- `workflow.{class}.failed`

### Step Timing

- `workflow.step.duration`
- `workflow.step.{type}.duration`

### Approval Metrics

- `workflow.approval.requested`
- `workflow.approval.resolved`
- `workflow.approval.wait_time`

### Authority Metrics

- `dax.authority.dax_state_machine`
- `dax.authority.dax_legacy`

---

## Future Extensions

### Potential v2 Workflows

- `test_and_validate` - Run tests and validate results
- `deploy_to_staging` - Deploy with automatic validation
- `security_scan` - Automated security assessment
- `dependency_audit` - Check for outdated dependencies

### Extension Criteria

1. Stable v1 artifact schemas
2. Proven operational patterns
3. Clear use case justification
4. Security review complete

---

## Summary

DAX v1 provides a production-ready deterministic workflow suite:

| Metric            | Value            |
| ----------------- | ---------------- |
| Workflow Classes  | 3                |
| Total Fixed Steps | 10               |
| Terminal States   | 8                |
| Approval Modes    | 2 (none, manual) |
| Trust Postures    | 2 (high, medium) |

This portfolio enables safe, observable, and controllable AI agent execution in professional environments.
