import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { compileWithRunId } from "../../src/execution/compiler"
import { ContractGuardian } from "../../src/execution/contract-guardian"
import { enforceRuntimeGuard, RuntimeGuardViolationError } from "../../src/execution/runtime-guard"
import { RunStore } from "../../src/state/run-store"
import { Transitions, RunCompletionBlockedError } from "../../src/state/transitions"

function buildIntentContract(targetFiles: string[], avoidAreas: string[] = []) {
  return {
    goal: "Apply a scoped code change safely",
    successCriteria: ["Stay within declared scope", "Verify before completion"],
    explicitConstraints: [],
    targetFiles,
    repoImpact: {
      targetFiles,
      avoidAreas,
    },
    validationCommands: ["bun test"],
    rollbackPlan: ["Use git diff against the starting baseline"],
  }
}

async function setupGuardedSession(input: {
  cwd: string
  targetFiles: string[]
  avoidAreas?: string[]
  mode?: string
  budgetOverride?: Partial<NonNullable<Awaited<ReturnType<typeof Session.get>>["state_v2"]>["runtime_guard"]["budget"]>
}) {
  const session = await Session.create({ title: "Runtime hardening test" })
  const request = {
    intent: {
      input: `Edit ${input.targetFiles.join(", ")}`,
      repoPath: input.cwd,
    },
  }
  const { contract } = compileWithRunId({ request }, session.id)
  await ContractGuardian.create(session.id, contract)
  await RunStore.create(session.id, contract.contractId)
  await Session.update(session.id, (draft) => {
    draft.state_v2 = {
      intent: {
        prompt: request.intent.input,
        intentType: "code_change",
        confidence: 0.9,
        activeMode: input.mode ?? "build",
        suggestedOperator: "build",
        requiredSkills: [],
        requestedOutput: "diff",
        riskLevel: "medium",
        scope: "repo",
        constraints: [],
        contract: buildIntentContract(input.targetFiles, input.avoidAreas),
      },
      activity_timeline: [],
      approvals: [],
      artifacts: [],
      audit_findings: [],
      runtime_guard: {
        budget: {
          maxFilesTouched: 8,
          maxMutatingCommands: 6,
          maxApprovalRequests: 4,
          maxRepeatedFailures: 3,
          filesTouched: 0,
          mutatingCommands: 0,
          approvalsRequested: 0,
          ...input.budgetOverride,
        },
        touchedFiles: [],
        failureCounts: {},
        verification: {
          required: false,
          satisfied: false,
          receipts: [],
        },
      },
    }
  })
  return session
}

describe("runtime hardening", () => {
  test("allows in-scope mutations and records verification receipts", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const target = "src/execution/compiler.ts"
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [target],
        })

        await enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "edit",
          callID: "call_edit_1",
          req: {
            permission: "edit",
            patterns: [target],
            always: ["*"],
            metadata: {
              filepath: path.join(process.cwd(), target),
              diff: "@@",
            },
          },
        })

        await enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "shell",
          callID: "call_verify_1",
          req: {
            permission: "shell",
            patterns: ["bun test test/determinism/runtime-hardening.test.ts"],
            always: ["bun test *"],
            metadata: {},
          },
        })

        const updated = await Session.get(session.id)
        expect(updated.state_v2?.runtime_guard?.touchedFiles.some((item) => item.endsWith(target))).toBe(true)
        expect(updated.state_v2?.runtime_guard?.verification.satisfied).toBe(true)
        expect(updated.state_v2?.runtime_guard?.rollbackAnchor?.createdAt).toBeDefined()
      },
    })
  })

  test("blocks out-of-scope mutations", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts"],
        })

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "edit",
            callID: "call_scope_1",
            req: {
              permission: "edit",
            patterns: ["src/session/prompt.ts"],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), "src/session/prompt.ts"),
                diff: "@@",
              },
            },
          }),
        ).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "scope_drift",
        })
      },
    })
  })

  test("blocks sensitive paths", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [".env"],
        })

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "write",
            callID: "call_sensitive_1",
            req: {
              permission: "edit",
              patterns: [".env"],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), ".env"),
                diff: "@@",
              },
            },
          }),
        ).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "sensitive_path",
        })
      },
    })
  })

  test("blocks mutation budget exhaustion", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts", "src/session/prompt.ts"],
          budgetOverride: {
            maxFilesTouched: 1,
          },
        })

        await enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "edit",
          callID: "call_budget_1",
          req: {
            permission: "edit",
            patterns: ["src/execution/compiler.ts"],
            always: ["*"],
            metadata: {
              filepath: path.join(process.cwd(), "src/execution/compiler.ts"),
              diff: "@@",
            },
          },
        })

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "edit",
            callID: "call_budget_2",
            req: {
              permission: "edit",
            patterns: ["src/session/prompt.ts"],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), "src/session/prompt.ts"),
                diff: "@@",
              },
            },
          }),
        ).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "mutation_budget",
        })
      },
    })
  })

  test("engages loop breaker after repeated blocked attempts", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts"],
          budgetOverride: {
            maxRepeatedFailures: 2,
          },
        })

        const blockedAttempt = () =>
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "edit",
            callID: `call_scope_repeat_${Math.random().toString(36).slice(2)}`,
            req: {
              permission: "edit",
              patterns: ["src/session/prompt.ts"],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), "src/session/prompt.ts"),
                diff: "@@",
              },
            },
          })

        await expect(blockedAttempt()).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "scope_drift",
        })

        await expect(blockedAttempt()).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "loop_break",
        })

        const updated = await Session.get(session.id)
        const failureCounts = updated.state_v2?.runtime_guard?.failureCounts ?? {}
        const blockedFingerprint = Object.keys(failureCounts).find((key) => key.startsWith("scope_drift::edit::"))
        expect(blockedFingerprint).toBeDefined()
        expect(blockedFingerprint ? failureCounts[blockedFingerprint] : 0).toBe(2)
      },
    })
  })

  test("blocks completion without verification evidence when required", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts"],
        })

        await RunStore.update(session.id, (state) => ({
          ...state,
          status: "running",
          governance: {
            ...state.governance,
            verification: {
              required: true,
              satisfied: false,
              receiptIds: [],
            },
          },
        }))

        await expect(Transitions.transition(session.id, "completed", "done")).rejects.toBeInstanceOf(
          RunCompletionBlockedError,
        )
      },
    })
  })
})
