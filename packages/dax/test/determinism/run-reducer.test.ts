import { describe, test, expect } from "bun:test"
import { createEvent, type RunEventEnvelope } from "../../src/state/events/run-event-types"
import { reduceRunState, type RunState } from "../../src/state/events/run-reducer"

const RUN_ID = "test-run-123"
const CONTRACT_ID = "test-contract-456"

function makeEnvelope(type: RunEventEnvelope["type"], seq: number, payload: unknown): RunEventEnvelope {
  return createEvent(RUN_ID, seq, type, payload)
}

describe("reduceRunState", () => {
  describe("deterministic projection", () => {
    test("same events produce same state (idempotence)", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
      ]

      const state1 = reduceRunState(events)
      const state2 = reduceRunState(events)

      expect(state1).toEqual(state2)
    })

    test("same events in same order produce identical deep state", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_001", approvalType: "tool", risk: "medium" }),
      ]

      const state1 = reduceRunState(events)
      const state2 = reduceRunState(events)

      expect(state1).toStrictEqual(state2)
      expect(state1?.runId).toBe(RUN_ID)
      expect(state1?.contractId).toBe(CONTRACT_ID)
    })
  })

  describe("lifecycle correctness", () => {
    test("minimal happy path: compiled -> queued -> running", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("running")
      expect(state?.pendingApprovalIds).toEqual([])
      expect(state?.artifactIds).toEqual([])
      expect(state?.startedAt).not.toBeNull()
      expect(state?.completedAt).toBeNull()
    })
  })

  describe("approval halt", () => {
    test("approval_requested halts workflow and records pending approval", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_halt_001", approvalType: "tool", risk: "medium" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("waiting_approval")
      expect(state?.pendingApprovalIds).toContain("apr_halt_001")
      expect(state?.pendingApprovalIds.length).toBe(1)
    })

    test("multiple approvals accumulate pending", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_001", approvalType: "tool", risk: "medium" }),
        makeEnvelope("approval_requested", 4, { approvalId: "apr_002", approvalType: "content", risk: "high" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("waiting_approval")
      expect(state?.pendingApprovalIds).toEqual(["apr_001", "apr_002"])
    })
  })

  describe("approval resume", () => {
    test("approval_resolved removes pending and resumes running", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_resume_001", approvalType: "tool", risk: "medium" }),
        makeEnvelope("approval_resolved", 4, { approvalId: "apr_resume_001", decision: "approved" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("running")
      expect(state?.pendingApprovalIds).toEqual([])
    })

    test("approval_resolved rejected keeps pending empty but run stays waiting", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_reject_001", approvalType: "tool", risk: "medium" }),
        makeEnvelope("approval_resolved", 4, { approvalId: "apr_reject_001", decision: "rejected" }),
      ]

      const state = reduceRunState(events)

      expect(state?.pendingApprovalIds).toEqual([])
    })

    test("multiple approvals - one resolved, one pending", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_001", approvalType: "tool", risk: "medium" }),
        makeEnvelope("approval_requested", 4, { approvalId: "apr_002", approvalType: "content", risk: "high" }),
        makeEnvelope("approval_resolved", 5, { approvalId: "apr_001", decision: "approved" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("waiting_approval")
      expect(state?.pendingApprovalIds).toEqual(["apr_002"])
    })
  })

  describe("step projection", () => {
    test("step_added creates step in proposed status", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("step_added", 3, { stepId: "step_001", title: "Write file", stepType: "proposed" }),
      ]

      const state = reduceRunState(events)

      expect(state?.steps).toHaveLength(1)
      expect(state?.steps[0].stepId).toBe("step_001")
      expect(state?.steps[0].title).toBe("Write file")
      expect(state?.steps[0].status).toBe("proposed")
      expect(state?.currentStepId).toBe("step_001")
    })

    test("step_started transitions step to running", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("step_added", 3, { stepId: "step_001", title: "Write file", stepType: "proposed" }),
        makeEnvelope("step_started", 4, { stepId: "step_001" }),
      ]

      const state = reduceRunState(events)

      expect(state?.steps[0].status).toBe("running")
      expect(state?.steps[0].startedAt).not.toBeNull()
    })

    test("step_completed transitions step to completed", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("step_added", 3, { stepId: "step_001", title: "Write file", stepType: "proposed" }),
        makeEnvelope("step_started", 4, { stepId: "step_001" }),
        makeEnvelope("step_completed", 5, { stepId: "step_001", outputs: ["file.txt"] }),
      ]

      const state = reduceRunState(events)

      expect(state?.steps[0].status).toBe("completed")
      expect(state?.steps[0].completedAt).not.toBeNull()
      expect(state?.steps[0].outputs).toEqual(["file.txt"])
      expect(state?.currentStepId).toBeNull()
    })

    test("step_failed transitions step to failed", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("step_added", 3, { stepId: "step_001", title: "Write file", stepType: "proposed" }),
        makeEnvelope("step_started", 4, { stepId: "step_001" }),
        makeEnvelope("step_failed", 5, {
          stepId: "step_001",
          error: { code: "E_FILE_WRITE", message: "Permission denied" },
        }),
      ]

      const state = reduceRunState(events)

      expect(state?.steps[0].status).toBe("failed")
      expect(state?.steps[0].error?.code).toBe("E_FILE_WRITE")
      expect(state?.currentStepId).toBeNull()
    })
  })

  describe("terminal state", () => {
    test("run_completed sets terminal status", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("run_completed", 3, {}),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("completed")
      expect(state?.completedAt).not.toBeNull()
    })

    test("run_failed sets terminal status with error", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("run_failed", 3, {
          error: { code: "E_TIMEOUT", message: "Execution timed out", retryable: false },
        }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("failed")
      expect(state?.error?.code).toBe("E_TIMEOUT")
      expect(state?.completedAt).not.toBeNull()
    })

    test("run_completed rejects pending approvals", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_pending", approvalType: "tool", risk: "medium" }),
        makeEnvelope("run_completed", 4, {}),
      ]

      expect(() => reduceRunState(events)).toThrow("pending approvals")
    })

    test("terminal state ignores subsequent events", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("run_completed", 3, {}),
        makeEnvelope("step_added", 4, { stepId: "step_001", title: "Late step", stepType: "proposed" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("completed")
      expect(state?.steps).toHaveLength(0)
    })
  })

  describe("draft_and_approve workflow proof", () => {
    test("approval_requested always reconstructs waiting_approval with same approvalId", () => {
      const baseEvents: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
      ]

      const run1Events = [
        ...baseEvents,
        makeEnvelope("approval_requested", 3, { approvalId: "apr_draft_001", approvalType: "tool", risk: "medium" }),
      ]
      const run2Events = [
        ...baseEvents,
        makeEnvelope("approval_requested", 3, { approvalId: "apr_draft_001", approvalType: "tool", risk: "medium" }),
      ]

      const state1 = reduceRunState(run1Events)
      const state2 = reduceRunState(run2Events)

      expect(state1?.status).toBe("waiting_approval")
      expect(state2?.status).toBe("waiting_approval")
      expect(state1?.pendingApprovalIds).toEqual(["apr_draft_001"])
      expect(state2?.pendingApprovalIds).toEqual(["apr_draft_001"])
      expect(state1).toStrictEqual(state2)
    })

    test("approval_resolved after approval_requested restores running state", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("approval_requested", 3, { approvalId: "apr_draft_002", approvalType: "tool", risk: "medium" }),
        makeEnvelope("approval_resolved", 4, { approvalId: "apr_draft_002", decision: "approved" }),
      ]

      const state = reduceRunState(events)

      expect(state?.status).toBe("running")
      expect(state?.pendingApprovalIds).toEqual([])
    })
  })

  describe("artifact tracking", () => {
    test("artifact_created adds artifact ID", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("artifact_created", 3, { artifactId: "artifact_001", artifactType: "file" }),
      ]

      const state = reduceRunState(events)

      expect(state?.artifactIds).toContain("artifact_001")
    })

    test("verification artifacts do not satisfy verification evidence without a recorded receipt", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("execution_queued", 1, {}),
        makeEnvelope("workflow_started", 2, {}),
        makeEnvelope("artifact_created", 3, {
          artifactId: "verification_report_001",
          artifactType: "verification_report",
        }),
      ]

      const state = reduceRunState(events)

      expect(state?.governance.verification.satisfied).toBe(false)
      expect(state?.governance.verification.receiptIds).toEqual([])
    })

    test("duplicate artifact IDs are deduplicated", () => {
      const events: RunEventEnvelope[] = [
        makeEnvelope("contract_compiled", 0, { contractId: CONTRACT_ID }),
        makeEnvelope("artifact_created", 1, { artifactId: "artifact_dup", artifactType: "file" }),
        makeEnvelope("artifact_created", 2, { artifactId: "artifact_dup", artifactType: "file" }),
      ]

      const state = reduceRunState(events)

      expect(state?.artifactIds).toEqual(["artifact_dup"])
    })
  })

  describe("empty events", () => {
    test("empty event array returns null", () => {
      const state = reduceRunState([])
      expect(state).toBeNull()
    })

    test("non-contract_compiled first event throws", () => {
      const events: RunEventEnvelope[] = [makeEnvelope("execution_queued", 0, {})]

      expect(() => reduceRunState(events)).toThrow("First event must be contract_compiled")
    })
  })
})
