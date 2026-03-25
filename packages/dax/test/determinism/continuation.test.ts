import { describe, test, expect } from "bun:test"
import path from "path"
import {
  createEventAuthorityRun,
  transitionEventAuthority,
  addStepEvent,
  startStepEvent,
  addApprovalEvent,
} from "../../src/state/events/event-transitions"
import { recoverRun } from "../../src/state/events/runtime-recovery"

let seqCounter = Date.now()
function makeRunId(seed: number): string {
  seqCounter++
  return `cont_test_${seqCounter}_${seed}`
}

describe("executable recovery continuation", () => {
  describe("continueRun", () => {
    test("waiting_approval returns pause continuation with approval ids", async () => {
      const runId = makeRunId(400)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_cont_1")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_cont_1"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const approvalId = "apr_cont_1"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.continuation).toBeDefined()
        expect(result.continuation!.nextStep).toBe("pause")
        expect(result.continuation!.approvalIds).toContain(approvalId)
      })
    })

    test("running returns resume_workflow continuation", async () => {
      const runId = makeRunId(401)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_cont_2")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_cont_2"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.continuation).toBeDefined()
        expect(result.continuation!.nextStep).toBe("resume_workflow")
        expect(result.continuation!.stepId).toBe(stepId)
      })
    })

    test("queued returns start_execution continuation", async () => {
      const runId = makeRunId(402)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_cont_3")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.continuation).toBeDefined()
        expect(result.continuation!.nextStep).toBe("start_execution")
      })
    })

    test("completed returns reject continuation", async () => {
      const runId = makeRunId(403)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_cont_4")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})
        await transitionEventAuthority(runId, "completed", "run_completed", {})

        const result = await recoverRun(runId)
        expect(result.success).toBe(true)
        expect(result.continuation).toBeDefined()
        expect(result.continuation!.nextStep).toBe("reject")
        expect(result.continuation!.reason).toContain("Terminal")
      })
    })
  })
})
