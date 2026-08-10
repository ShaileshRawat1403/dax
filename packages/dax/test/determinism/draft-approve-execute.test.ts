import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { rmSync, mkdirSync } from "fs"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { Instance } from "../../src/project/instance"
import { RunStore } from "../../src/state/run-store"
import { compile } from "../../src/execution/compiler"
import { Transitions } from "../../src/state/transitions"
import { DraftApproveExecuteEffects, DraftApproveExecuteWorkflow } from "../../src/workflows/draft-approve-execute"

describe("draft_and_approve workflow halting", () => {
  const testHome = path.join(os.tmpdir(), `dax-draft-approve-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
    // Drafting reaches a provider now. This test is about halting at the
    // approval gate, not about draft content, so the model call is stubbed.
    DraftApproveExecuteEffects.set({
      generateDraft: async () => "test content for test.txt\n",
    })
  })

  afterEach(() => {
    DraftApproveExecuteEffects.reset()
    if (previousHome) {
      process.env.DAX_TEST_HOME = previousHome
    } else {
      delete process.env.DAX_TEST_HOME
    }
    try {
      rmSync(testHome, { recursive: true, force: true })
    } catch (e) {}
  })

  test("workflow halts after requesting approval and waits for resume", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test workflow" })
      const request = {
        intent: { input: "write a file to test.txt" },
        workflowHint: "draft_and_approve" as const,
      }

      const { contract } = compile({ request })
      contract.runId = session.id
      contract.contractId = "test_contract_id"

      await RunStore.create(session.id, contract.contractId)
      await Transitions.transition(session.id, "compiled", "contract_compiled")
      await Transitions.transition(session.id, "queued", "execution_queued")
      await Transitions.transition(session.id, "running", "workflow_started")

      const workflow = new DraftApproveExecuteWorkflow({
        runId: session.id,
        contract,
      })

      // Execute the workflow
      const result = await workflow.execute()

      // It should succeed up to the halt point
      expect(result.success).toBe(true)
      // Should contain 2 steps: prepare_draft, request_approval
      expect(result.stepResults).toHaveLength(2)
      // No final artifact should be present
      expect(result.finalArtifactId).toBeUndefined()

      // The run state should be waiting_approval
      const state = await RunStore.get(session.id)
      expect(state).not.toBeNull()
      expect(state!.status).toBe("waiting_approval")

      // Assuming we resume with approval
      const approvalId = state!.pendingApprovalIds[0]
      expect(approvalId).toBeDefined()

      const resumeResult = await workflow.resumeAfterApproval(approvalId, "approved")
      expect(resumeResult.success).toBe(true)
      expect(resumeResult.stepResults).toHaveLength(1) // commit_execution
      expect(resumeResult.finalArtifactId).toBeDefined()
    })
  })
})
