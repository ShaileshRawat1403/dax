import { describe, test, expect } from "bun:test"
import path from "path"
import {
  createEventAuthorityRun,
  transitionEventAuthority,
  addStepEvent,
  startStepEvent,
  addApprovalEvent,
  resolveApprovalEvent,
  getEventAuthorityState,
} from "../../src/state/events/event-transitions"
import { getProjectedRunState } from "../../src/state/events/run-event-store"
import { evaluateRecovery, evaluateRunRecovery } from "../../src/state/events/recovery"

let seqCounter = Date.now()
function makeRunId(seed: number): string {
  seqCounter++
  return `recovery_test_${seqCounter}_${seed}`
}

describe("recovery policy", () => {
  describe("evaluateRecovery", () => {
    test("waiting_approval returns remain_paused", () => {
      const state: any = {
        runId: "test",
        contractId: "c1",
        status: "waiting_approval",
        currentStepId: null,
        steps: [],
        pendingApprovalIds: ["apr_001"],
        artifactIds: [],
        draft: null,
        trust: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }

      const decision = evaluateRecovery(state)
      expect(decision.action).toBe("remain_paused")
      expect(decision.reason).toContain("waiting for approval")
    })

    test("completed returns immutable", () => {
      const state: any = {
        runId: "test",
        contractId: "c1",
        status: "completed",
        currentStepId: null,
        steps: [],
        pendingApprovalIds: [],
        artifactIds: [],
        draft: null,
        trust: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }

      const decision = evaluateRecovery(state)
      expect(decision.action).toBe("immutable")
    })

    test("failed returns immutable", () => {
      const state: any = {
        runId: "test",
        contractId: "c1",
        status: "failed",
        currentStepId: null,
        steps: [],
        pendingApprovalIds: [],
        artifactIds: [],
        draft: null,
        trust: null,
        error: { code: "test_error", message: "test" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }

      const decision = evaluateRecovery(state)
      expect(decision.action).toBe("immutable")
    })

    test("running with incomplete step returns resume", () => {
      const state: any = {
        runId: "test",
        contractId: "c1",
        status: "running",
        currentStepId: "step_001",
        steps: [],
        pendingApprovalIds: [],
        artifactIds: [],
        draft: null,
        trust: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }

      const decision = evaluateRecovery(state)
      expect(decision.action).toBe("resume")
      expect(decision.incompleteStepId).toBe("step_001")
    })

    test("queued returns retry", () => {
      const state: any = {
        runId: "test",
        contractId: "c1",
        status: "queued",
        currentStepId: null,
        steps: [],
        pendingApprovalIds: [],
        artifactIds: [],
        draft: null,
        trust: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      }

      const decision = evaluateRecovery(state)
      expect(decision.action).toBe("retry")
    })
  })

  describe("recovery from event-authority state", () => {
    test("waiting_approval run recovers as remain_paused", async () => {
      const runId = makeRunId(200)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_recovery_1")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_recovery_1"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const approvalId = "apr_recovery_1"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const decision = await evaluateRunRecovery(runId)
        expect(decision).not.toBeNull()
        expect(decision!.action).toBe("remain_paused")
        expect(decision!.pendingApprovalIds).toContain(approvalId)
      })
    })

    test("completed run recovers as immutable", async () => {
      const runId = makeRunId(201)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_recovery_2")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})
        await transitionEventAuthority(runId, "completed", "run_completed", {})

        const decision = await evaluateRunRecovery(runId)
        expect(decision).not.toBeNull()
        expect(decision!.action).toBe("immutable")
      })
    })

    test("running run with incomplete step recovers as resume", async () => {
      const runId = makeRunId(202)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_recovery_3")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_recovery_3"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const projectedState = await getProjectedRunState(runId)
        expect(projectedState?.currentStepId).toBe(stepId)

        const decision = await evaluateRunRecovery(runId)
        expect(decision).not.toBeNull()
        expect(decision!.action).toBe("resume")
        expect(decision!.incompleteStepId).toBe(stepId)
      })
    })
  })
})
