import { describe, expect, test } from "bun:test"
import { evaluatePlanQuality } from "./plan-quality-gate"
import type { ExecutionContract } from "./execution-contract"

function baseContract(overrides?: Partial<ExecutionContract>): ExecutionContract {
  const now = "2026-04-02T00:00:00.000Z"
  return {
    schemaVersion: "v1",
    contractId: "ctr_test",
    runId: "run_test",
    workflowClass: "draft_and_approve",
    intent: "Update src/cli/cmd/tui/routes/home.tsx and verify with bun run --cwd packages/dax typecheck",
    executionMode: "approval_gated",
    riskLevel: "medium",
    toolAllowlist: ["read", "grep", "edit"],
    toolBlocklist: [],
    approvalPolicy: {
      mode: "approval_gated",
      requireForRiskAbove: "low",
      toolCategories: ["edit", "shell"],
    },
    expectedOutputs: [{ type: "diff", description: "Patched home route" }],
    timeoutMs: 1800000,
    runtimePolicy: {
      scope: {
        targetFiles: ["src/cli/cmd/tui/routes/home.tsx"],
        targetSubsystems: ["tui-home"],
        avoidAreas: ["src/state"],
      },
      budgets: {
        maxFilesTouched: 8,
        maxMutatingCommands: 6,
        maxApprovalRequests: 4,
        maxRepeatedFailures: 3,
      },
      postconditions: {
        verificationRequired: true,
        validationPlan: ["run dax typecheck"],
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

describe("plan quality gate", () => {
  test("proceeds for a concrete plan with scope, validation, and rollback hints", () => {
    const summary = evaluatePlanQuality(baseContract())
    expect(summary.decision).toBe("proceed")
    expect(summary.score).toBe(100)
    expect(summary.failedChecks).toEqual([])
    expect(summary.guidance).toEqual([])
  })

  test("pauses weak mutating plans and returns concrete operator guidance", () => {
    const summary = evaluatePlanQuality(
      baseContract({
        intent: "fix it",
        runtimePolicy: {
          scope: {
            targetFiles: [],
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
            validationCommands: [],
          },
          sensitivity: {
            sensitivePatterns: [],
            forbiddenPatterns: [],
          },
        },
      }),
    )
    expect(summary.decision).toBe("pause")
    expect(summary.failedChecks).toContain("goal_specificity")
    expect(summary.failedChecks).toContain("scope_declared")
    expect(summary.failedChecks).toContain("validation_declared")
    expect(summary.failedChecks).toContain("rollback_declared")
    expect(summary.guidance.length).toBeGreaterThan(0)
  })

  test("is deterministic for identical inputs except timestamp", () => {
    const contract = baseContract()
    const first = evaluatePlanQuality(contract)
    const second = evaluatePlanQuality(contract)

    expect({
      score: first.score,
      decision: first.decision,
      failedChecks: first.failedChecks,
      guidance: first.guidance,
    }).toEqual({
      score: second.score,
      decision: second.decision,
      failedChecks: second.failedChecks,
      guidance: second.guidance,
    })
  })
})

