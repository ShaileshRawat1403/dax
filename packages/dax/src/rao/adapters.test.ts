import { describe, expect, test } from "bun:test"
import { RAOAdapter } from "./adapters"
import { RAOProtocol } from "./schema"
import { createInitialRunState, type RunState, type StepRecord } from "@/state/run-state"
import { createApproval } from "@/approval/approval-types"
import type { ExecutionContract } from "@/execution/execution-contract"

function step(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    stepId: "s1",
    title: "Apply the patch",
    type: "executed",
    status: "running",
    startedAt: null,
    completedAt: null,
    error: null,
    outputs: [],
    ...overrides,
  }
}

function runState(overrides: Partial<RunState> = {}): RunState {
  return { ...createInitialRunState("run_1", "ctr_1"), ...overrides }
}

describe("RAOAdapter.toRAORunState", () => {
  const statusMap: [RunState["status"], RAOProtocol.RunState["status"]][] = [
    ["created", "planned"],
    ["compiled", "planned"],
    ["queued", "running"],
    ["running", "running"],
    ["waiting_approval", "waiting_approval"],
    ["completed", "verified"],
    ["failed", "failed"],
    ["cancelled", "failed"],
  ]

  for (const [internal, expected] of statusMap) {
    test(`maps internal status ${internal} to RAO ${expected}`, () => {
      expect(RAOAdapter.toRAORunState(runState({ status: internal })).status).toBe(expected)
    })
  }

  test("produces a schema-valid RunState", () => {
    const out = RAOAdapter.toRAORunState(runState({ status: "running" }))
    expect(() => RAOProtocol.RunState.parse(out)).not.toThrow()
  })

  test("maps the current step and translates its status", () => {
    const out = RAOAdapter.toRAORunState(
      runState({ currentStepId: "s1", steps: [step({ stepId: "s1", title: "Apply the patch", status: "running" })] }),
    )
    expect(out.currentStep).toEqual({ stepId: "s1", description: "Apply the patch", status: "running" })
  })

  test("translates proposed and blocked step status to pending", () => {
    for (const s of ["proposed", "blocked"] as const) {
      const out = RAOAdapter.toRAORunState(runState({ currentStepId: "s1", steps: [step({ status: s })] }))
      expect(out.currentStep?.status).toBe("pending")
    }
  })

  test("omits currentStep when the id is unset or not found", () => {
    expect(RAOAdapter.toRAORunState(runState({ currentStepId: null })).currentStep).toBeUndefined()
    expect(
      RAOAdapter.toRAORunState(runState({ currentStepId: "missing", steps: [step({ stepId: "s1" })] })).currentStep,
    ).toBeUndefined()
  })

  // Audit gap H2: evidence is drawn from what the run recorded (completion
  // proof, DAX-run verification, mutation ledger), not fabricated.
  test("populates evidence from the run's recorded receipts (H2)", () => {
    const base = createInitialRunState("run_1", "ctr_1")
    const out = RAOAdapter.toRAORunState({
      ...base,
      status: "completed",
      completedAt: "2026-01-01T00:00:00.000Z",
      governance: {
        ...base.governance,
        verification: { required: true, satisfied: true, receiptIds: ["rcpt_verify_1"] },
        mutationReceiptIds: ["rcpt_mut_1"],
        completionProof: {
          decision: "pass",
          failedChecks: [],
          verificationExecuted: true,
          receiptIds: ["rcpt_verify_1"],
          artifactChecks: true,
          expectedOutputChecks: true,
          expectedOutputTypesSatisfied: [],
          expectedOutputTypesMissing: [],
          scopeChecks: true,
          sensitivePathApprovalChecks: true,
          checkedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    })
    expect(out.evidence.length).toBeGreaterThan(0)
    expect(() => RAOProtocol.RunState.parse(out)).not.toThrow()
    const sources = out.evidence.map((e) => e.source)
    expect(sources).toContain("dax_completion_proof")
    expect(sources).toContain("dax_verification")
    expect(sources).toContain("dax_mutation_ledger")
    // Every receipt points back at the run and validates against the schema.
    for (const receipt of out.evidence) {
      expect(receipt.runId).toBe("run_1")
      expect(() => RAOProtocol.EvidenceReceipt.parse(receipt)).not.toThrow()
    }
  })

  test("emits no evidence when the run recorded nothing verifiable (honest empty, not theater)", () => {
    const out = RAOAdapter.toRAORunState(runState({ status: "completed" }))
    expect(out.evidence).toEqual([])
  })
})

describe("RAOAdapter.toRAOApprovalRequest", () => {
  function approval(
    context?: Parameters<typeof createApproval>[0]["context"],
    type: "tool_use" | "command_execute" = "tool_use",
  ) {
    return createApproval({
      approvalId: "apr_1",
      runId: "run_1",
      type,
      risk: "high",
      title: "Approve edit",
      reason: "edits a governed file",
      context,
    })
  }

  test("prefers toolName, then command, then the approval type for the proposed tool", () => {
    expect(RAOAdapter.toRAOApprovalRequest(approval({ toolName: "edit", filePath: "a.ts" })).proposedAction.tool).toBe(
      "edit",
    )
    expect(RAOAdapter.toRAOApprovalRequest(approval({ command: "rm -rf x" })).proposedAction.tool).toBe("rm -rf x")
    expect(RAOAdapter.toRAOApprovalRequest(approval(undefined)).proposedAction.tool).toBe("tool_use")
  })

  test("carries reason, risk and action parameters through, schema-valid", () => {
    const out = RAOAdapter.toRAOApprovalRequest(approval({ toolName: "edit", filePath: "a.ts", command: "c" }))
    expect(out.approvalId).toBe("apr_1")
    expect(out.runId).toBe("run_1")
    expect(out.reason).toBe("edits a governed file")
    expect(out.risk).toBe("high")
    expect(out.proposedAction.parameters).toEqual({ filePath: "a.ts", command: "c" })
    expect(() => RAOProtocol.ApprovalRequest.parse(out)).not.toThrow()
  })

  test("summarizes a diff preview from a unified patch", () => {
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-old line",
      "+new line",
      "+another",
    ].join("\n")
    const out = RAOAdapter.toRAOApprovalRequest(approval({ diffPreview: patch }))
    expect(out.diffPreview).toEqual({ filesChanged: 1, additions: 2, deletions: 1, patch })
  })

  test("omits diffPreview when the approval has none", () => {
    expect(RAOAdapter.toRAOApprovalRequest(approval({ toolName: "edit" })).diffPreview).toBeUndefined()
  })
})

describe("RAOAdapter.toRAORunRequest", () => {
  function contract(overrides: Partial<ExecutionContract> = {}): ExecutionContract {
    return {
      contractId: "ctr_1",
      runId: "run_1",
      workflowClass: "generic",
      intent: "add a helper",
      executionMode: "auto",
      riskLevel: "medium",
      toolAllowlist: ["read", "edit"],
      toolBlocklist: [],
      approvalPolicy: { mode: "auto" },
      expectedOutputs: [],
      timeoutMs: 1800000,
      createdAt: new Date().toISOString(),
      schemaVersion: "v1",
      ...overrides,
    }
  }

  test("maps intent, actor, risk and tools into a schema-valid RunRequest", () => {
    const out = RAOAdapter.toRAORunRequest(contract({ projectId: "proj", repoPath: "/repo", initiatedBy: "alice" }))
    expect(out.intent).toBe("add a helper")
    expect(out.scope).toEqual({ projectId: "proj", directories: ["/repo"] })
    expect(out.actor).toEqual({ id: "alice", type: "system" })
    expect(out.riskProfile).toEqual({ level: "medium", factors: [] })
    expect(out.allowedTools).toEqual([{ name: "read" }, { name: "edit" }])
    expect(() => RAOProtocol.RunRequest.parse(out)).not.toThrow()
  })

  test("defaults project, directories and actor when unset", () => {
    const out = RAOAdapter.toRAORunRequest(contract({ projectId: undefined, repoPath: undefined, initiatedBy: undefined }))
    expect(out.scope).toEqual({ projectId: "unknown-project", directories: undefined })
    expect(out.actor.id).toBe("system")
  })
})
