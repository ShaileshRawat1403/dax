import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { compileWithRunId } from "../../src/execution/compiler"
import { ContractGuardian } from "../../src/execution/contract-guardian"
import { enforceRuntimeGuard, RuntimeGuardViolationError } from "../../src/execution/runtime-guard"
import { RunStore } from "../../src/state/run-store"
import { Transitions, RunCompletionBlockedError } from "../../src/state/transitions"
import { ApprovalStore } from "../../src/approval/approval-store"

let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = path.join(
    os.tmpdir(),
    `dax-runtime-hardening-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
})

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
  await RunStore.update(session.id, (state) => ({
    ...state,
    governance: {
      ...state.governance,
      guardEnforcementMode: "enforce",
    },
  }))
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
        order: 0,
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
      guard_enforcement_mode: "enforce",
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
        expect(
          updated.state_v2?.runtime_guard?.touchedFiles.some((item) =>
            item.replaceAll("\\", "/").endsWith(target.replaceAll("\\", "/")),
          ),
        ).toBe(true)
        expect(updated.state_v2?.runtime_guard?.verification.satisfied).toBe(true)
        expect(updated.state_v2?.runtime_guard?.baselineCheckpoint?.createdAt).toBeDefined()
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

  test("allows approved sensitive paths when approval signal explicitly references the path", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const target = ".github/workflows/ci.yml"
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [target],
        })

        await Session.update(session.id, (draft) => {
          draft.state_v2 = {
            ...(draft.state_v2 ?? {
              activity_timeline: [],
              approvals: [],
              artifacts: [],
              audit_findings: [],
            }),
            intent: {
              ...(draft.state_v2?.intent ?? {
                prompt: "",
                intentType: "code_change",
                confidence: 0.9,
                activeMode: "build",
                suggestedOperator: "build",
                requiredSkills: [],
                requestedOutput: "diff",
                riskLevel: "medium",
                scope: "repo",
                constraints: [],
              }),
              prompt:
                "Approve mutation of sensitive CI file: .github/workflows/ci.yml to add non-blocking mutation job.",
            },
          }
        })

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "apply_patch",
            callID: "call_sensitive_approved_1",
            req: {
              permission: "edit",
              patterns: [target],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), target),
                diff: "@@",
              },
            },
          }),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("allows implicit approval and budget bypass for the lab zone", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts"],
          budgetOverride: {
            maxMutatingCommands: 1,
            maxFilesTouched: 1,
          },
        })

        const labFile = ".dax/lab/repro_bug_123.ts"

        // 1. Verify lab write is allowed even if not in targetFiles
        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "write",
            req: {
              permission: "write",
              patterns: [labFile],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), labFile),
              },
            },
          }),
        ).resolves.toBeUndefined()

        // 2. Verify lab write doesn't count against mutation budget
        // Run 3 lab writes (exceeding budget of 1)
        for (let i = 0; i < 3; i++) {
          await enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "write",
            req: {
              permission: "write",
              patterns: [`.dax/lab/test_${i}.ts`],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), `.dax/lab/test_${i}.ts`),
              },
            },
          })
        }

        const updated = await Session.get(session.id)
        // Lab files should NOT be in touchedFiles
        expect(updated.state_v2?.runtime_guard?.touchedFiles.length).toBe(0)
        expect(updated.state_v2?.runtime_guard?.budget.mutatingCommands).toBe(0)

        // 3. Verify that a real mutation still counts and triggers budget exhaustion
        const target = "src/execution/compiler.ts"
        await enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "edit",
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

        // Second real mutation should fail
        const target2 = "src/execution/runtime-guard.ts"
        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "edit",
            req: {
              permission: "edit",
              patterns: [target2],
              always: ["*"],
              metadata: {
                filepath: path.join(process.cwd(), target2),
                diff: "@@",
              },
            },
          }),
        ).rejects.toThrow(RuntimeGuardViolationError)
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
        expect(blockedFingerprint ? failureCounts[blockedFingerprint] : 0).toBe(1)
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

        // Verify intervention was persisted
        const approvals = await ApprovalStore.getApprovals(session.id)
        const gate = approvals.find((a) => a.type === "workflow_gate" && a.title.includes("Completion proof"))
        expect(gate).toBeDefined()
        expect(gate?.risk).toBe("high")
      },
    })
  })

  test("blocks path traversal and outside workspace escapes", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: ["src/execution/compiler.ts"],
        })

        // Simple traversal
        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            toolID: "edit",
            req: {
              permission: "edit",
              patterns: ["src/execution/../../.env"],
              always: ["*"],
              metadata: { filepath: path.resolve(process.cwd(), "src/execution/../../.env") },
            },
          }),
        ).rejects.toMatchObject({ code: "sensitive_path" })

        // Absolute path outside workspace
        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            toolID: "read",
            req: {
              permission: "read",
              patterns: ["/etc/passwd"],
              always: ["*"],
              metadata: { filepath: "/etc/passwd" },
            },
          }),
        ).rejects.toMatchObject({ code: "forbidden_path" })
      },
    })
  })

  test("blocks successive identical tool calls (doom loop)", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const target = "src/execution/compiler.ts"
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [target],
          budgetOverride: { maxRepeatedFailures: 3 },
        })

        const call = () =>
          enforceRuntimeGuard({
            sessionID: session.id,
            toolID: "edit",
            req: {
              permission: "edit",
              patterns: [target],
              always: ["*"],
              metadata: { filepath: target },
            },
          })

        await call()
        await call()
        await expect(call()).rejects.toMatchObject({ code: "loop_break" })
      },
    })
  })

  test("blocks mutations in explore and docs modes", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const target = "src/execution/compiler.ts"
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [target],
          mode: "explore",
        })

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            toolID: "edit",
            req: {
              permission: "edit",
              patterns: [target],
              always: ["*"],
              metadata: { filepath: target },
            },
          }),
        ).rejects.toMatchObject({ code: "illegal_transition" })
      },
    })
  })
})
