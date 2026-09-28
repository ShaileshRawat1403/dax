import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowClass } from "@/execution/workflow-class"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { listFixedWorkflowCapabilities, requireFixedWorkflowCapability } from "./capability-identity"
import { DraftApproveExecuteWorkflow, DraftApproveExecuteEffects } from "./draft-approve-execute"
import { RepoAnalyzeWorkflow } from "./repo-analyze"
import { ReviewAndSignoffWorkflow } from "./review-and-signoff"
import { WorkerRunWorkflow } from "./worker-run"
import { cleanupHarnessRuns, eventByType, runWorkflowAndCaptureEvents } from "./workflow-event-harness"

const home = mkdtempSync(path.join(os.tmpdir(), "dax-workflow-identity-"))
const workspace = path.join(home, "workspace")
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = home
mkdirSync(workspace, { recursive: true })

function contract(workflowClass: WorkflowClass) {
  const runId = `run_workflow_identity_${randomUUID().replaceAll("-", "")}`
  return ExecutionContract.parse({
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass,
    intent: "Prove workflow identity",
    executionMode: "approval_gated",
    riskLevel: "low",
    toolAllowlist: [],
    toolBlocklist: [],
    approvalPolicy: { mode: "approval_gated" },
    expectedOutputs: [{ type: "report", description: "Identity probe" }],
    createdAt: new Date().toISOString(),
  })
}

async function expectIdentityFailure(operation: () => Promise<unknown>) {
  let failure: unknown
  try {
    await operation()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(CapabilityIdentityError)
}

afterEach(() => DraftApproveExecuteEffects.reset())

afterAll(async () => {
  await cleanupHarnessRuns()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe("fixed workflow descriptive identity", () => {
  test("vocabulary has every execute and approval-resume boundary but no authority", () => {
    const descriptors = listFixedWorkflowCapabilities()
    expect(descriptors.map((entry) => entry.id).sort()).toEqual([
      "workflow.draft_and_approve.execute",
      "workflow.draft_and_approve.resume_after_approval",
      "workflow.repo_analyze.execute",
      "workflow.review_and_signoff.execute",
      "workflow.worker_run.execute",
      "workflow.worker_run.resume_after_approval",
    ])
    for (const descriptor of descriptors) {
      expect(CapabilityDescriptor.safeParse(descriptor).success).toBe(true)
      expect(descriptor.scopeSupport).toBe("opaque")
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect("grant" in descriptor).toBe(false)
    }
  })

  test("real registry dispatch executes an enrolled repo workflow", async () => {
    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "repo_analyze",
      contract: contract("repo_analyze"),
      directory: workspace,
    })
    expect(run.result.success).toBe(true)
    expect(eventByType(run.events, "workflow_completed")).toHaveLength(1)
  })

  test("real registry dispatch executes draft before its existing approval gate", async () => {
    let drafts = 0
    DraftApproveExecuteEffects.set({
      generateDraft: async () => {
        drafts++
        return "draft content"
      },
    })
    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: contract("draft_and_approve"),
      directory: workspace,
    })
    expect(run.result.success).toBe(true)
    expect(drafts).toBe(1)
    expect(eventByType(run.events, "approval_requested")).toHaveLength(1)
    expect(eventByType(run.events, "mutation_recorded")).toHaveLength(0)
  })

  test("a direct constructor cannot claim a different workflow before effects", async () => {
    const actual = contract("draft_and_approve")
    const wrong = { ...actual, workflowClass: "repo_analyze" as const }
    let drafts = 0
    DraftApproveExecuteEffects.set({
      generateDraft: async () => {
        drafts++
        return "must not run"
      },
    })
    await expectIdentityFailure(() =>
      new DraftApproveExecuteWorkflow({ runId: actual.runId, contract: wrong }).execute(),
    )
    expect(drafts).toBe(0)
    await expectIdentityFailure(() =>
      new DraftApproveExecuteWorkflow({ runId: `${actual.runId}_other`, contract: actual }).execute(),
    )
    expect(drafts).toBe(0)
  })

  test("fake and derived workflow receivers cannot run the built-in method", async () => {
    const repo = contract("repo_analyze")
    const fake = Object.create(RepoAnalyzeWorkflow.prototype) as RepoAnalyzeWorkflow
    await expectIdentityFailure(() => RepoAnalyzeWorkflow.prototype.execute.call(fake))
    class Derived extends RepoAnalyzeWorkflow {}
    await expectIdentityFailure(() => new Derived({ runId: repo.runId, contract: repo }).execute())
    const falseReview = Object.create(ReviewAndSignoffWorkflow.prototype) as ReviewAndSignoffWorkflow
    await expectIdentityFailure(() => ReviewAndSignoffWorkflow.prototype.execute.call(falseReview))
    const worker = contract("worker_run")
    const falseWorker = Object.create(WorkerRunWorkflow.prototype) as WorkerRunWorkflow
    await expectIdentityFailure(() => WorkerRunWorkflow.prototype.execute.call(falseWorker))
    await expectIdentityFailure(() =>
      WorkerRunWorkflow.prototype.resumeAfterApproval.call(falseWorker, "approval", "denied"),
    )
    await expectIdentityFailure(() =>
      new WorkerRunWorkflow({
        runId: worker.runId,
        contract: { ...worker, workflowClass: "repo_analyze" },
      }).resumeAfterApproval("approval", "denied"),
    )
  })

  test("an invalid phase or contract class cannot resolve a descriptor", () => {
    const repo = contract("repo_analyze")
    expect(() =>
      requireFixedWorkflowCapability({
        workflowClass: "repo_analyze",
        phase: "resume_after_approval",
        contract: repo,
        runId: repo.runId,
      }),
    ).toThrow(CapabilityIdentityError)
    expect(() =>
      requireFixedWorkflowCapability({
        workflowClass: "worker_run",
        phase: "execute",
        contract: repo,
        runId: repo.runId,
      }),
    ).toThrow(CapabilityIdentityError)
  })
})
