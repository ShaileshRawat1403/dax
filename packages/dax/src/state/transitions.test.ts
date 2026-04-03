import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import type { ExecutionContract } from "@/execution/execution-contract"

function contractFor(runId: string): ExecutionContract {
  const now = "2026-04-02T00:00:00.000Z"
  return {
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass: "draft_and_approve",
    intent: `Patch src/main.ts and verify for ${runId}`,
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
        targetFiles: ["src/main.ts"],
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
        verificationRequired: false,
        validationPlan: ["typecheck"],
        validationCommands: ["bun run --cwd packages/dax typecheck"],
      },
      sensitivity: {
        sensitivePatterns: [".env*"],
        forbiddenPatterns: ["../"],
      },
    },
    createdAt: now,
  }
}

describe("run transition invariants", () => {
  test(
    "blocks waiting_approval -> running when approvals remain pending",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-transition-pending-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { RunStore } = await import("./run-store")
        const { Transitions, RunInvariantBlockedError } = await import("./transitions")
        const { ContractGuardian } = await import("@/execution/contract-guardian")
        const repoRoot = path.resolve(import.meta.dir, "../../..")
        const runId = "run_pending_block"

        await bootstrap(repoRoot, async () => {
          await RunStore.create(runId, "ctr_pending")
          await ContractGuardian.create(runId, contractFor(runId))
          await RunStore.update(runId, (state) => ({
            ...state,
            status: "waiting_approval",
            pendingApprovalIds: ["apr_pending_1"],
          }))

          await expect(Transitions.transition(runId, "running", "approval_pending")).rejects.toBeInstanceOf(
            RunInvariantBlockedError,
          )
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "blocks completion in enforce mode when completion proof is missing",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-transition-enforce-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { RunStore } = await import("./run-store")
        const { Transitions, RunCompletionBlockedError } = await import("./transitions")
        const { ContractGuardian } = await import("@/execution/contract-guardian")
        const repoRoot = path.resolve(import.meta.dir, "../../..")
        const runId = "run_enforce_block"

        await bootstrap(repoRoot, async () => {
          await RunStore.create(runId, "ctr_enforce")
          await ContractGuardian.create(runId, contractFor(runId))
          await RunStore.update(runId, (state) => ({
            ...state,
            status: "running",
            governance: {
              ...state.governance,
              guardEnforcementMode: "enforce",
              touchedFiles: ["src/main.ts"],
            },
            pendingApprovalIds: [],
            artifactIds: [],
          }))

          await expect(Transitions.transition(runId, "completed", "finalize")).rejects.toBeInstanceOf(
            RunCompletionBlockedError,
          )
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "records completion proof but allows completion in warn mode",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-transition-warn-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { RunStore } = await import("./run-store")
        const { Transitions } = await import("./transitions")
        const { ContractGuardian } = await import("@/execution/contract-guardian")
        const repoRoot = path.resolve(import.meta.dir, "../../..")
        const runId = "run_warn_complete"

        await bootstrap(repoRoot, async () => {
          await RunStore.create(runId, "ctr_warn")
          await ContractGuardian.create(runId, contractFor(runId))
          await RunStore.update(runId, (state) => ({
            ...state,
            status: "running",
            governance: {
              ...state.governance,
              guardEnforcementMode: "warn",
              touchedFiles: ["src/main.ts"],
            },
            pendingApprovalIds: [],
            artifactIds: [],
          }))

          const next = await Transitions.transition(runId, "completed", "finalize")
          expect(next.status).toBe("completed")
          expect(next.governance.completionProof?.decision).toBe("fail")
          expect(next.governance.completionProof?.failedChecks).toContain("missing_artifacts")
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )
})

