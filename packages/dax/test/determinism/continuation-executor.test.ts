import { describe, test, expect } from "bun:test"
import path from "path"
import {
  createEventAuthorityRun,
  transitionEventAuthority,
  addStepEvent,
  startStepEvent,
  completeStepEvent,
  addApprovalEvent,
} from "../../src/state/events/event-transitions"
import { executeContinuation } from "../../src/state/events/continuation-executor"

let seqCounter = Date.now()
function makeRunId(seed: number): string {
  seqCounter++
  return `exec_cont_${seqCounter}_${seed}`
}

describe("continuation executor", () => {
  describe("executeContinuation", () => {
    test("waiting_approval execution pauses with approvals", async () => {
      const runId = makeRunId(500)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_1")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_exec_1"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const approvalId = "apr_exec_1"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("paused")
        expect(result.approvals).toContain(approvalId)
        expect(result.message).toContain("Pending approvals")
      })
    })

    test("running execution resumes with step", async () => {
      const runId = makeRunId(501)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_2")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_exec_2"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("resumed")
        expect(result.status).toBe("running")
        expect(result.stepId).toBe(stepId)
        expect(result.message).toContain(stepId)
      })
    })

    test("queued execution starts from queued", async () => {
      const runId = makeRunId(502)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_3")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("started")
        expect(result.status).toBe("running")
        expect(result.message).toContain("started from queued")
      })
    })

    test("compiled execution starts by moving to queued then running", async () => {
      const runId = makeRunId(503)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_4")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("started")
        expect(result.status).toBe("running")
        expect(result.message).toContain("started from queued")
      })
    })

    test("completed execution is rejected", async () => {
      const runId = makeRunId(504)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_5")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})
        await transitionEventAuthority(runId, "completed", "run_completed", {})

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("rejected")
        expect(result.message).toContain("Terminal")
      })
    })

    test("failed execution is rejected", async () => {
      const runId = makeRunId(505)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, "contract_exec_6")
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})
        await transitionEventAuthority(runId, "failed", "run_failed", {
          error: { code: "test", message: "test", retryable: false },
        })

        const result = await executeContinuation(runId)
        expect(result.success).toBe(true)
        expect(result.action).toBe("rejected")
        expect(result.message).toContain("Terminal")
      })
    })

    test("non-existent run returns invalid", async () => {
      const runId = makeRunId(506)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const result = await executeContinuation(runId)
        expect(result.success).toBe(false)
        expect(result.action).toBe("invalid")
      })
    })
  })
})
