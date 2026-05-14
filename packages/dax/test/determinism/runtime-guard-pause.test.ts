import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { compileWithRunId } from "../../src/execution/compiler"
import { ContractGuardian } from "../../src/execution/contract-guardian"
import { enforceRuntimeGuard, RuntimeGuardViolationError } from "../../src/execution/runtime-guard"
import { RunStore } from "../../src/state/run-store"
import { ApprovalStore } from "../../src/approval/approval-store"
import { Bus } from "../../src/bus"
import { Lifecycle } from "../../src/bus/lifecycle"
import { ApprovalTransitions } from "../../src/approval/approval-transitions"

function buildIntentContract(targetFiles: string[], avoidAreas: string[] = []) {
  return {
    goal: "Apply a scoped code change safely",
    successCriteria: ["Stay within declared scope", "Verify before completion"],
    explicitConstraints: [],
    targetFiles,
    repoImpact: { targetFiles, avoidAreas },
    validationCommands: ["bun test"],
    rollbackPlan: ["Use git diff against the starting baseline"],
  }
}

async function setupGuardedSession(input: { cwd: string; targetFiles: string[] }) {
  const session = await Session.create({ title: "Runtime guard pause test" })
  const request = {
    intent: { input: `Edit ${input.targetFiles.join(", ")}`, repoPath: input.cwd },
  }
  const { contract } = compileWithRunId({ request }, session.id)
  await ContractGuardian.create(session.id, contract)
  await RunStore.create(session.id, contract.contractId)
  await RunStore.update(session.id, (state) => ({
    ...state,
    governance: { ...state.governance, guardEnforcementMode: "enforce" },
  }))
  await Session.update(session.id, (draft) => {
    draft.state_v2 = {
      intent: {
        prompt: request.intent.input,
        intentType: "code_change",
        confidence: 0.9,
        activeMode: "build",
        suggestedOperator: "build",
        requiredSkills: [],
        requestedOutput: "diff",
        riskLevel: "medium",
        order: 0,
        scope: "repo",
        constraints: [],
        contract: buildIntentContract(input.targetFiles),
      },
      activity_timeline: [],
      approvals: [],
      artifacts: [],
      runtime_guard: {
        failureCounts: {},
        budget: { maxRepeatedFailures: 3 },
      },
    } as any
  })
  return session
}

describe("runtime-guard pause-and-await", () => {
  test("rejects when operator denies the approval", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [".env"],
        })

        // Start the guard. With test-default timeout=0 it rejects without
        // an operator. With timeout=200ms we have a window to emit the
        // approval decision before the timer fires.
        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "200"

        const guardPromise = enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "write",
          callID: "call_pause_deny_1",
          req: {
            permission: "edit",
            patterns: [".env"],
            always: ["*"],
            metadata: {
              filepath: path.join(process.cwd(), ".env"),
              diff: "@@",
            },
          },
        })

        // Wait for the approval to be created, then emit a deny decision.
        const approval = await waitForApprovalCreation(session.id, 500)
        await Bus.publish(Lifecycle.ApprovalResolved, {
          runId: session.id,
          approvalId: approval.approvalId,
          decision: "deny",
          comment: "operator-denied-test",
        })

        await expect(guardPromise).rejects.toMatchObject<Partial<RuntimeGuardViolationError>>({
          code: "sensitive_path",
        })

        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
      },
    })
  })

  test("resolves and allows the tool call when operator approves", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [".env"],
        })

        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "200"

        const guardPromise = enforceRuntimeGuard({
          sessionID: session.id,
          agent: "build",
          toolID: "write",
          callID: "call_pause_approve_1",
          req: {
            permission: "edit",
            patterns: [".env"],
            always: ["*"],
            metadata: {
              filepath: path.join(process.cwd(), ".env"),
              diff: "@@",
            },
          },
        })

        const approval = await waitForApprovalCreation(session.id, 500)
        await Bus.publish(Lifecycle.ApprovalResolved, {
          runId: session.id,
          approvalId: approval.approvalId,
          decision: "approve",
          comment: "operator-approved-test",
        })

        // The guard should resolve (return undefined). The tool call would
        // then proceed in production.
        await expect(guardPromise).resolves.toBeUndefined()

        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
      },
    })
  })

  test("treats timeout as deny so the model is not blocked indefinitely", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [".env"],
        })

        // Already 0 from preload, but be explicit so the test is readable.
        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "write",
            callID: "call_pause_timeout_1",
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

  test("timeout marks the approval expired so it stops surfacing as pending", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupGuardedSession({
          cwd: process.cwd(),
          targetFiles: [".env"],
        })

        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"

        await expect(
          enforceRuntimeGuard({
            sessionID: session.id,
            agent: "build",
            toolID: "write",
            callID: "call_pause_timeout_state_1",
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
        ).rejects.toBeDefined()

        const approvals = await ApprovalStore.getApprovals(session.id)
        expect(approvals.length).toBeGreaterThan(0)
        const latest = approvals[approvals.length - 1]
        expect(latest.status).toBe("expired")
        expect(latest.status).not.toBe("pending")
      },
    })
  })
})

async function waitForApprovalCreation(runId: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const approvals = await ApprovalStore.getApprovals(runId)
    const pending = approvals.find((a) => a.status === "pending")
    if (pending) return pending
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`No approval was created for run ${runId} within ${timeoutMs}ms`)
}

// Cross-reference, kept here only to make IDE jumps work.
void ApprovalTransitions
