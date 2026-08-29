import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"

describe("Flowright capability service", () => {
  test("invokes dax.repo_analyze and returns a valid DAX-owned receipt", async () => {
    const testHome = path.join(os.tmpdir(), `dax-flowright-capability-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { FlowrightCapabilityService } = await import("./capability-service")
      const { CapabilityRunReceipt } = await import("./capability-contract")
      const { RunGateway } = await import("@/server/run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const response = await FlowrightCapabilityService.invoke("dax.repo_analyze", {
          invocationId: "cap_repo_analyze_test",
          input: {
            prompt: "Analyze this repository structure and produce a read-only report.",
            repoPath: repoRoot,
          },
          flowright: {
            runId: "flowright-run-1",
            stepId: "analyze_repo",
            attemptNumber: 1,
          },
          timeoutMs: 3000,
        })

        expect(response.invocationId).toBe("cap_repo_analyze_test")
        expect(response.externalRunId).toBe(response.receipt.externalRunId)
        expect(CapabilityRunReceipt.parse(response.receipt)).toEqual(response.receipt)
        expect(response.receipt.capability).toBe("dax.repo_analyze")
        expect(response.receipt.authority).toBe("dax")
        expect(response.receipt.terminalState).toBe("succeeded")
        expect(response.receipt.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(response.receipt.approvals).toEqual([])
        expect(response.receipt.deepLink).toBe(`/runs/${response.externalRunId}`)

        const fetched = await FlowrightCapabilityService.getReceipt("cap_repo_analyze_test")
        expect(fetched.invocationId).toBe(response.invocationId)
        expect(fetched.externalRunId).toBe(response.externalRunId)
        expect(fetched.evidenceDigest).toBe(response.receipt.evidenceDigest)

        const evidenceBefore = await FlowrightCapabilityService.exportEvidence("cap_repo_analyze_test")
        await RunGateway.__testing.appendEvent(response.externalRunId, {
          type: "run.state_changed",
          payload: { previousStatus: "completed", currentStatus: "failed", reason: "compatibility-only" },
        })
        const evidenceAfter = await FlowrightCapabilityService.exportEvidence("cap_repo_analyze_test")
        expect(evidenceAfter).toEqual(evidenceBefore)
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("forwards dax.draft_and_approve approvals into terminal receipts", async () => {
    const testHome = path.join(os.tmpdir(), `dax-flowright-approval-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { FlowrightCapabilityService } = await import("./capability-service")
      const { DraftApproveExecuteEffects } = await import("@/workflows/draft-approve-execute")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      // Drafting reaches a provider now. This test is about approval
      // forwarding and receipt terminality, not draft content.
      DraftApproveExecuteEffects.set({ generateDraft: async () => "Release note draft.\n" })

      await bootstrap(repoRoot, async () => {
        const response = await FlowrightCapabilityService.invoke("dax.draft_and_approve", {
          invocationId: "cap_draft_approve_test",
          input: {
            prompt: "Draft a release note and wait for approval.",
          },
          timeoutMs: 3000,
        })

        expect(response.receipt.terminalState).toBe("needs_approval")
        const gate = response.receipt.approvals.find((approval) => approval.status === "pending")
        expect(gate).toBeDefined()

        const approved = await FlowrightCapabilityService.decideApproval("cap_draft_approve_test", gate!.gateId, {
          decision: "approve",
          actorId: "flowright-test",
        })

        expect(approved.terminalState).toBe("succeeded")
        expect(approved.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(approved.completedAt).toBeDefined()
      })
    } finally {
      const { DraftApproveExecuteEffects } = await import("@/workflows/draft-approve-execute")
      DraftApproveExecuteEffects.reset()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)
})
