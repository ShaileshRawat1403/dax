import { describe, expect, test } from "bun:test"
import { evaluateCompletionProof } from "./completion-proof"
import type { ExecutionContract } from "./execution-contract"
import type { RunState } from "../state/run-state"

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

describe("Completion Proof Logic", () => {
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

  test("Fails on scope violation", () => {
    const runState = mockRunState({
      governance: {
        ...mockRunState().governance,
        touchedFiles: ["src/outside.ts"],
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
})
