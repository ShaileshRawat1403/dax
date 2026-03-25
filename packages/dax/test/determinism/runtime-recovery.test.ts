import { describe, test, expect } from "bun:test"
import path from "path"
import {
  createEventAuthorityRun,
  transitionEventAuthority,
  addStepEvent,
  startStepEvent,
  completeStepEvent,
  addApprovalEvent,
  resolveApprovalEvent,
} from "../../src/state/events/event-transitions"
import { recoverRun, executeRecovery } from "../../src/state/events/runtime-recovery"
import { evaluateRecovery } from "../../src/state/events/recovery"

let seqCounter = Date.now()
function makeRunId(seed: number): string {
  seqCounter++
  return `runtime_rec_${seqCounter}_${seed}`
}

describe("runtime recovery integration", () => {
  describe("recoverRun", () => {
    test("waiting_approval returns remain_paused with approval info", async () => {
      const runId = makeRunId(300)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_1")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_rt_rec_1"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const approvalId = "apr_rt_rec_1"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("remain_paused")
        expect(result.previousStatus).toBe("waiting_approval")
        expect(result.newStatus).toBe("waiting_approval")
        expect(result.message).toContain("pending approval")
        expect(result.message).toContain(approvalId)
      })
    })

    test("completed returns immutable message", async () => {
      const runId = makeRunId(301)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_2")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})
        await transitionEventAuthority(runId, "completed", "run_completed", {})

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("immutable")
        expect(result.message).toContain("terminal state")
      })
    })

    test("running with incomplete step returns resume info", async () => {
      const runId = makeRunId(302)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_3")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_rt_rec_3"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("resume")
        expect(result.message).toContain(stepId)
      })
    })

    test("queued returns retry info", async () => {
      const runId = makeRunId(303)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_4")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("retry")
        expect(result.message).toContain("ready for execution")
      })
    })

    test("non-existent run returns invalid", async () => {
      const runId = makeRunId(304)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const result = await recoverRun(runId)
        expect(result.success).toBe(false)
        expect(result.action).toBe("invalid")
        expect(result.message).toContain("not found")
      })
    })
  })

  describe("executeRecovery", () => {
    test("remain_paused execution preserves state", async () => {
      const runId = makeRunId(305)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_5")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const approvalId = "apr_rt_rec_5"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const decision = await evaluateRecovery({
          runId,
          contractId: "c",
          status: "waiting_approval",
          currentStepId: null,
          steps: [],
          pendingApprovalIds: [approvalId],
          artifactIds: [],
          draft: null,
          trust: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        })

        const result = await executeRecovery(runId, decision)
        expect(result.success).toBe(true)
        expect(result.action).toBe("remain_paused")
        expect(result.newStatus).toBe("waiting_approval")
      })
    })

    test("resume execution handles running state", async () => {
      const runId = makeRunId(306)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_rt_rec_6")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_rt_rec_6"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const decision = await evaluateRecovery({
          runId,
          contractId: "c",
          status: "running",
          currentStepId: stepId,
          steps: [
            {
              stepId,
              title: "Test Step",
              type: "proposed",
              status: "running",
              startedAt: null,
              completedAt: null,
              error: null,
              outputs: [],
            },
          ],
          pendingApprovalIds: [],
          artifactIds: [],
          draft: null,
          trust: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: null,
        })

        const result = await executeRecovery(runId, decision)
        expect(result.success).toBe(true)
        expect(result.action).toBe("resume")
        expect(result.message).toContain(stepId)
      })
    })
  })
})
