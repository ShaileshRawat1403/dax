import { describe, expect, test } from "bun:test"
import { evaluateCompletionProof } from "../../src/execution/completion-proof"
import type { ExecutionContract } from "../../src/execution/execution-contract"
import type { RunState } from "../../src/state/run-state"

const mockContract: ExecutionContract = {
  contractId: "ctr_1",
  runId: "run_1",
  workflowClass: "generic",
  intent: "test",
  executionMode: "auto",
  riskLevel: "medium",
  toolAllowlist: [],
  toolBlocklist: [],
  approvalPolicy: { mode: "auto" },
  expectedOutputs: [],
  timeoutMs: 1800000,
  createdAt: new Date().toISOString(),
  runtimePolicy: {
    scope: {
      targetFiles: ["src/index.ts"],
      targetSubsystems: [],
      avoidAreas: [],
    },
    budgets: {
      maxFilesTouched: 8,
      maxMutatingCommands: 6,
      maxApprovalRequests: 4,
      maxRepeatedFailures: 3,
    },
    postconditions: {
      verificationRequired: true,
      validationPlan: [],
      validationCommands: ["bun test"],
    },
    sensitivity: {
      sensitivePatterns: [],
      forbiddenPatterns: [],
    },
  },
  schemaVersion: "v1",
}

const mockRunState = (overrides: Partial<RunState> = {}): RunState => ({
  runId: "run_1",
  contractId: "ctr_1",
  status: "running",
  currentStepId: null,
  steps: [],
  artifactIds: [],
  pendingApprovalIds: [],
  governance: {
    touchedFiles: [],
    mutationReceiptIds: [],
    verification: {
      required: false,
      satisfied: false,
      receiptIds: [],
    },
    budget: {
      maxFilesTouched: 8,
      maxMutatingCommands: 6,
      maxApprovalRequests: 4,
      maxRepeatedFailures: 3,
      filesTouched: 0,
      mutatingCommands: 0,
      approvalsRequested: 0,
    },
    guardEnforcementMode: "enforce",
    failureCounts: {},
    completionProof: null,
    baselineCheckpoint: null,
    planQuality: null,
  },
  trust: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  ...overrides,
})

describe("Completion Proof Determinism", () => {
  test("Passes when all evidence is present", () => {
    const runState = mockRunState({
      artifactIds: ["art_1"],
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/index.ts"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: true,
          satisfied: true,
          receiptIds: ["call_2"],
        },
      },
    })

    const proof = evaluateCompletionProof({ contract: mockContract, runState })
    expect(proof.decision).toBe("pass")
    expect(proof.failedChecks).toHaveLength(0)
    expect(proof.verificationExecuted).toBe(true)
    expect(proof.receiptIds).toContain("call_1")
    expect(proof.receiptIds).toContain("call_2")
  })

  test("Fails when verification is missing for mutations", () => {
    const runState = mockRunState({
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/index.ts"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: false,
          satisfied: false,
          receiptIds: [],
        },
      },
    })

    const proof = evaluateCompletionProof({ contract: mockContract, runState })
    expect(proof.decision).toBe("fail")
    expect(proof.failedChecks).toContain("unverified_mutation")
  })

  test("Fails when artifacts are missing for expected writes", () => {
    const runState = mockRunState({
      artifactIds: [],
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/index.ts"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: true,
          satisfied: true,
          receiptIds: ["call_2"],
        },
      },
    })

    const proof = evaluateCompletionProof({ contract: mockContract, runState })
    expect(proof.decision).toBe("fail")
    expect(proof.failedChecks).toContain("missing_artifacts")
  })

  test("Fails on scope violation", () => {
    const runState = mockRunState({
      artifactIds: ["art_1"],
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/dangerous.ts"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: true,
          satisfied: true,
          receiptIds: ["call_2"],
        },
      },
    })

    const proof = evaluateCompletionProof({ contract: mockContract, runState })
    expect(proof.decision).toBe("fail")
    expect(proof.failedChecks).toContain("scope_violation")
  })

  test("Fails on unapproved sensitive changes", () => {
    const runState = mockRunState({
      artifactIds: ["art_1"],
      pendingApprovalIds: ["app_1"], // Has a pending approval
      governance: {
        ...mockRunState().governance,
        touchedFiles: [".env"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: true,
          satisfied: true,
          receiptIds: ["call_2"],
        },
      },
    })

    const proof = evaluateCompletionProof({ contract: mockContract, runState })
    expect(proof.decision).toBe("fail")
    expect(proof.failedChecks).toContain("unapproved_sensitive_change")
  })

  test("Deterministic: identical inputs yield identical results", () => {
    const runState = mockRunState({
      artifactIds: ["art_1"],
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/index.ts"],
        mutationReceiptIds: ["call_1"],
        verification: {
          required: true,
          satisfied: true,
          receiptIds: ["call_2"],
        },
      },
    })

    const proof1 = evaluateCompletionProof({ contract: mockContract, runState })
    const proof2 = evaluateCompletionProof({ contract: mockContract, runState })

    // evaluateCompletionProof is pure - same inputs produce same outputs (no checkedAt)
    expect(proof1.decision).toBe(proof2.decision)
    expect(proof1.failedChecks).toEqual(proof2.failedChecks)
    expect(proof1.verificationExecuted).toBe(proof2.verificationExecuted)
    expect(proof1.receiptIds).toEqual(proof2.receiptIds)
    expect(proof1.artifactChecks).toBe(proof2.artifactChecks)
    expect(proof1.scopeChecks).toBe(proof2.scopeChecks)
    expect(proof1.sensitivePathApprovalChecks).toBe(proof2.sensitivePathApprovalChecks)
  })
})
