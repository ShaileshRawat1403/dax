import { afterAll, afterEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { mkdtempSync } from "fs"
import { randomUUID } from "node:crypto"
import { DraftApproveExecuteEffects, renderDraftPrompt, type DraftRequest } from "./draft-approve-execute"
import { cleanupHarnessRuns, eventByType, runWorkflowAndCaptureEvents } from "./workflow-event-harness"
import { ExecutionContract } from "@/execution/execution-contract"

const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-draft-"))
const workspace = path.join(testHome, "workspace")
process.env.DAX_TEST_HOME = testHome

let runCounter = 0
const makeRunId = () =>
  `run_draft_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 8)}_${++runCounter}`

const request = (overrides: Partial<DraftRequest> = {}): DraftRequest => ({
  intent: "add an isEven helper",
  output: { type: "file", description: "a TypeScript helper module", pathHint: "src/is-even.ts" },
  writeScope: [],
  forbiddenPaths: [],
  ...overrides,
})

function makeContract(overrides: Partial<ExecutionContract> = {}): ExecutionContract {
  const runId = overrides.runId ?? makeRunId()
  return ExecutionContract.parse({
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass: "draft_and_approve",
    intent: "add an isEven helper",
    executionMode: "approval_gated",
    riskLevel: "low",
    toolAllowlist: [],
    toolBlocklist: [],
    approvalPolicy: { mode: "approval_gated", toolCategories: ["edit"] },
    expectedOutputs: [{ type: "file", description: "a TypeScript helper", pathHint: "src/is-even.ts" }],
    timeoutMs: 60_000,
    createdAt: new Date().toISOString(),
    ...overrides,
  })
}

describe("draft prompt", () => {
  test("carries the contract's scope and forbidden paths to the model", () => {
    // The prompt is the entire interface between contract and draft. Scope
    // dropped here means a draft that ignores the governed boundary and an
    // operator asked to approve it anyway.
    const prompt = renderDraftPrompt(request({ writeScope: ["src/**"], forbiddenPaths: ["package.json", ".env"] }))

    expect(prompt).toContain("add an isEven helper")
    expect(prompt).toContain("src/is-even.ts")
    expect(prompt).toContain("CONFINE CHANGES TO: src/**")
    expect(prompt).toContain("NEVER TOUCH: package.json, .env")
  })

  test("omits scope lines entirely when the contract declares none", () => {
    const prompt = renderDraftPrompt(request())

    expect(prompt).not.toContain("CONFINE CHANGES TO")
    expect(prompt).not.toContain("NEVER TOUCH")
  })
})

describe("draft_and_approve workflow", () => {
  afterEach(() => DraftApproveExecuteEffects.reset())
  afterAll(async () => {
    await cleanupHarnessRuns()
  })

  test("the drafted content reaches the approval gate", async () => {
    const drafted = "export const isEven = (n: number) => n % 2 === 0\n"
    DraftApproveExecuteEffects.set({ generateDraft: async () => drafted })

    const { result, events } = await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: makeContract(),
      directory: workspace,
    })

    expect(result.success).toBe(true)
    expect(eventByType(events, "approval_requested").length).toBeGreaterThan(0)
  })

  test("the contract's intent and declared scope reach the drafting step", async () => {
    let seen: DraftRequest | undefined
    DraftApproveExecuteEffects.set({
      generateDraft: async (input) => {
        seen = input
        return "drafted"
      },
    })

    await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: makeContract({
        intent: "document the release gate",
        expectedOutputs: [{ type: "file", description: "a markdown doc", pathHint: "docs/release.md" }],
      }),
      directory: workspace,
    })

    expect(seen?.intent).toBe("document the release gate")
    expect(seen?.output.pathHint).toBe("docs/release.md")
    expect(seen?.output.description).toBe("a markdown doc")
  })

  test("an empty draft fails the step instead of reaching an operator", async () => {
    // The step's only product is the thing a human is asked to approve. This
    // workflow previously emitted a hardcoded string that said it was a
    // placeholder and sent it to the gate regardless, which invites a real
    // approval of nothing. Failing closed is the correct behaviour.
    DraftApproveExecuteEffects.set({ generateDraft: async () => "   \n  " })

    const { result, events } = await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: makeContract(),
      directory: workspace,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("prepare_draft failed")
    expect(eventByType(events, "approval_requested")).toHaveLength(0)
  })

  test("a failing drafting model fails the step rather than approving a stub", async () => {
    DraftApproveExecuteEffects.set({
      generateDraft: async () => {
        throw new Error("no model available to draft with")
      },
    })

    const { result, events } = await runWorkflowAndCaptureEvents({
      workflowClass: "draft_and_approve",
      contract: makeContract(),
      directory: workspace,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("no model available")
    expect(eventByType(events, "approval_requested")).toHaveLength(0)
  })
})
