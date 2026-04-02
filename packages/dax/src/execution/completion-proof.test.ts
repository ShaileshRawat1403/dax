import { describe, expect, test } from "bun:test"
import type { ExecutionContract } from "./execution-contract"
import { deriveCompletionProof } from "./completion-proof"
import { createInitialRunState } from "@/state/run-state"

function baseContract(overrides?: Partial<ExecutionContract>): ExecutionContract {
  const now = "2026-04-02T00:00:00.000Z"
  return {
    schemaVersion: "v1",
    contractId: "ctr_completion",
    runId: "run_completion",
    workflowClass: "draft_and_approve",
    intent: "Update src/index.ts and verify changes",
    executionMode: "approval_gated",
    riskLevel: "medium",
    toolAllowlist: ["read", "edit"],
    toolBlocklist: [],
    approvalPolicy: {
      mode: "approval_gated",
      requireForRiskAbove: "low",
      toolCategories: ["edit"],
    },
    expectedOutputs: [{ type: "file", description: "Updated source file" }],
    timeoutMs: 1800000,
    runtimePolicy: {
      scope: {
        targetFiles: ["src/index.ts"],
        targetSubsystems: [],
        avoidAreas: [".env"],
      },
      budgets: {
        maxFilesTouched: 8,
        maxMutatingCommands: 6,
        maxApprovalRequests: 4,
        maxRepeatedFailures: 3,
      },
      postconditions: {
        verificationRequired: true,
        validationPlan: ["typecheck"],
        validationCommands: ["bun run --cwd packages/dax typecheck"],
      },
      sensitivity: {
        sensitivePatterns: [".env*"],
        forbiddenPatterns: ["../"],
      },
    },
    createdAt: now,
    ...overrides,
  }
}

describe("completion proof", () => {
  test("blocks completion when verification and artifact evidence are missing", () => {
    const runState = createInitialRunState("run_completion", "ctr_completion")
    runState.governance.mutationReceiptIds = ["rcpt_mut_1"]
    runState.governance.touchedFiles = ["src/index.ts"]
    runState.artifactIds = []

    const proof = deriveCompletionProof({
      contract: baseContract(),
      runState,
    })

    expect(proof.ready).toBe(false)
    expect(proof.missing).toContain("verification receipts")
    expect(proof.missing).toContain("verification linked to mutation receipts")
    expect(proof.missing).toContain("expected artifact evidence")
  })

  test("returns ready=true with verification receipts, artifacts, and in-scope changes", () => {
    const runState = createInitialRunState("run_completion", "ctr_completion")
    runState.governance.verification.required = true
    runState.governance.verification.satisfied = true
    runState.governance.verification.receiptIds = ["verification_receipt_1"]
    runState.governance.mutationReceiptIds = ["mutation_receipt_1"]
    runState.governance.touchedFiles = ["src/index.ts"]
    runState.artifactIds = ["artifact_1"]

    const proof = deriveCompletionProof({
      contract: baseContract(),
      runState,
    })

    expect(proof.ready).toBe(true)
    expect(proof.missing).toEqual([])
    expect(proof.scopeSatisfied).toBe(true)
  })

  test("flags out-of-scope and sensitive-without-approval cases", () => {
    const runState = createInitialRunState("run_completion", "ctr_completion")
    runState.governance.touchedFiles = [".env.local", "src/other.ts"]
    runState.pendingApprovalIds = ["apr_1"]

    const proof = deriveCompletionProof({
      contract: baseContract(),
      runState,
    })

    expect(proof.ready).toBe(false)
    expect(proof.missing).toContain("scope proof")
    expect(proof.missing).toContain("sensitive path approval")
  })
})

