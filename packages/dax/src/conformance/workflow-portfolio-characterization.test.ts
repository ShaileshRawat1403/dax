import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { ExecutionContract } from "@/execution/execution-contract"
import { DraftApproveExecuteEffects } from "@/workflows/draft-approve-execute"
import {
  ReviewAndSignoffWorkflow,
  type SignoffResult,
} from "@/workflows/review-and-signoff"
import {
  cleanupHarnessRuns,
  eventByType,
  runWorkflowAndCaptureEvents,
} from "@/workflows/workflow-event-harness"
import type { WorkflowClass } from "@/execution/workflow-class"

/**
 * These are product/workflow characterizations, not Universal Execution
 * Boundary rows. They preserve the useful facts from the former five-path
 * meter without pretending that orchestration, signoff or a preset is an
 * independent execution kernel.
 */

const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-workflow-portfolio-"))
const workspace = path.join(testHome, "workspace")
const previousTestHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = testHome
mkdirSync(workspace, { recursive: true })

function contract(workflowClass: WorkflowClass, timeoutMs = 60_000): ExecutionContract {
  const runId = `run_portfolio_${randomUUID().replaceAll("-", "")}`
  const expectedOutputs =
    workflowClass === "draft_and_approve"
      ? [{ type: "file" as const, description: "Generated module", pathHint: "src/generated.ts" }]
      : [{ type: "report" as const, description: "Governed report" }]
  return ExecutionContract.parse({
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass,
    intent: `Characterize ${workflowClass}`,
    executionMode: "approval_gated",
    riskLevel: "low",
    toolAllowlist: [],
    toolBlocklist: [],
    approvalPolicy: { mode: "approval_gated" },
    expectedOutputs,
    timeoutMs,
    createdAt: new Date().toISOString(),
  })
}

afterEach(() => DraftApproveExecuteEffects.reset())

afterAll(async () => {
  await cleanupHarnessRuns()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

describe("workflow portfolio characterization outside the execution-kernel meter", () => {
  test("draft publishes an approvable artifact but does not apply it", async () => {
    DraftApproveExecuteEffects.set({
      generateDraft: async () => "export const generated = true\n",
    })
    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: contract("draft_and_approve"),
      directory: workspace,
    })

    expect(run.result.success).toBe(true)
    expect(eventByType(run.events, "draft_created")).toHaveLength(1)
    expect(eventByType(run.events, "approval_requested")).toHaveLength(1)
    expect(eventByType(run.events, "mutation_recorded")).toHaveLength(0)
    expect(await Bun.file(path.join(workspace, "src", "generated.ts")).exists()).toBe(false)
  })

  test("repo analysis is template/report orchestration, not execution evidence", async () => {
    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "repo_analyze",
      contract: contract("repo_analyze"),
      directory: workspace,
    })
    const outputText = run.result.stepResults
      .flatMap((step) => step.outputs)
      .map((output) => output.content)
      .join("\n")

    expect(run.result.success).toBe(true)
    expect(outputText).toContain("template analysis")
    expect(eventByType(run.events, "step_completed")).toHaveLength(3)
    expect(eventByType(run.events, "tool_result_recorded")).toHaveLength(0)
    expect(eventByType(run.events, "mutation_recorded")).toHaveLength(0)
  })

  test("expired review signoff has no receipt and replays as workflow expiration", async () => {
    const prototype = ReviewAndSignoffWorkflow.prototype as unknown as {
      waitForSignoff(deadline: number): Promise<SignoffResult>
    }
    const waitForSignoff = spyOn(prototype, "waitForSignoff").mockResolvedValue({
      decision: "expired",
      timestamp: new Date().toISOString(),
    })
    try {
      const run = await runWorkflowAndCaptureEvents({
        workflowClass: "review_and_signoff",
        contract: contract("review_and_signoff"),
        directory: workspace,
      })

      expect(eventByType(run.events, "signoff_requested")).toHaveLength(1)
      expect(eventByType(run.events, "signoff_received")).toHaveLength(0)
      expect(eventByType(run.events, "approval_requested")).toHaveLength(0)
      expect(eventByType(run.events, "approval_resolved")).toHaveLength(0)
      expect(eventByType(run.events, "mutation_recorded")).toHaveLength(0)
      expect(eventByType(run.events, "workflow_signed_off")).toHaveLength(0)
      expect(eventByType(run.events, "workflow_expired")).toHaveLength(1)
      expect(run.result.success).toBe(false)
      expect(run.state?.status).toBe("cancelled")
      expect(run.result.stepResults).toHaveLength(3)
    } finally {
      waitForSignoff.mockRestore()
    }
  })

  test("accepted signoff retains its durable receipt and signed-off terminal", async () => {
    const prototype = ReviewAndSignoffWorkflow.prototype as unknown as {
      waitForSignoff(deadline: number): Promise<SignoffResult>
    }
    const waitForSignoff = spyOn(prototype, "waitForSignoff").mockResolvedValue({
      decision: "signed_off",
      actorId: "operator_1",
      timestamp: new Date().toISOString(),
    })
    try {
      const run = await runWorkflowAndCaptureEvents({
        workflowClass: "review_and_signoff",
        contract: contract("review_and_signoff"),
        directory: workspace,
      })

      expect(eventByType(run.events, "signoff_received")).toHaveLength(1)
      expect(eventByType(run.events, "signoff_received")[0]?.payload).toEqual({ decision: "signed_off" })
      expect(eventByType(run.events, "workflow_signed_off")).toHaveLength(1)
      expect(run.result.success).toBe(true)
      expect(run.state?.status).toBe("completed")
    } finally {
      waitForSignoff.mockRestore()
    }
  })

  test("rejected signoff retains its durable receipt and rejected terminal", async () => {
    const prototype = ReviewAndSignoffWorkflow.prototype as unknown as {
      waitForSignoff(deadline: number): Promise<SignoffResult>
    }
    const waitForSignoff = spyOn(prototype, "waitForSignoff").mockResolvedValue({
      decision: "rejected",
      actorId: "operator_1",
      reason: "findings unresolved",
      timestamp: new Date().toISOString(),
    })
    try {
      const run = await runWorkflowAndCaptureEvents({
        workflowClass: "review_and_signoff",
        contract: contract("review_and_signoff"),
        directory: workspace,
      })

      expect(eventByType(run.events, "signoff_received")).toHaveLength(1)
      expect(eventByType(run.events, "signoff_received")[0]?.payload).toEqual({ decision: "rejected" })
      expect(eventByType(run.events, "workflow_rejected")).toHaveLength(1)
      expect(run.result.success).toBe(false)
      expect(run.state?.status).toBe("cancelled")
    } finally {
      waitForSignoff.mockRestore()
    }
  })
})
