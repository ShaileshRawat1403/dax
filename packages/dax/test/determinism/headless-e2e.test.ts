import { describe, expect, test } from "bun:test"
import { createEventAuthorityRun } from "../../src/state/events/event-transitions"
import { getProjectedRunState } from "../../src/state/events/run-event-store"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { RunLifecycle, RunLifecycle as Transitions } from "../../src/state/run-lifecycle"
import { enforceRuntimeGuard } from "../../src/execution/runtime-guard"
import { RunStore } from "../../src/state/run-store"
import { ApprovalStore } from "../../src/approval/approval-store"
import { ContractGuardian } from "../../src/execution/contract-guardian"
import { compileWithRunId } from "../../src/execution/compiler"

async function setupE2ESession(mode: string, prompt: string) {
  const session = await Session.create({ title: "Headless E2E Dummy Run" })
  const crossPlatformTargets = Array.from(
    new Set([
      "src/dummy.ts",
      "src\\dummy.ts",
      "packages/dax/src/dummy.ts",
      "packages\\dax\\src\\dummy.ts",
    ]),
  )
  const request = {
    intent: {
      input: prompt,
      repoPath: process.cwd(),
    },
  }
  const { contract } = compileWithRunId({ request }, session.id)
  
  // Hard override contract to match our test expectations and use modern schema
  const testContract = {
    ...contract,
    expectedOutputs: [{ type: "file", description: "Updated source file" }],
    runtimePolicy: {
      scope: {
        // Runtime guard normalizes touched files relative to worktree root.
        // Keep both forms here so the test remains deterministic across nested package worktrees.
        targetFiles: crossPlatformTargets,
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
      }
    }
  }

  await ContractGuardian.create(session.id, testContract as any)
  await createEventAuthorityRun(session.id, testContract.contractId, false, "enforce")
  // The guard's budget bookkeeping still lives on the legacy row; seed it from
  // the projection so the row exists before the guard updates it.
  await RunStore.save(session.id, (await getProjectedRunState(session.id))!)
  await RunStore.update(session.id, (state) => ({
    ...state,
    governance: {
      ...state.governance,
      guardEnforcementMode: "enforce",
    }
  }))
  
  await Session.update(session.id, (draft) => {
    draft.state_v2 = {
      intent: {
        prompt,
        intentType: mode === "explore" ? "exploration" : "code_change",
        confidence: 0.9,
        activeMode: mode,
        suggestedOperator: mode,
        requiredSkills: [],
        requestedOutput: "text",
        riskLevel: "medium",
        order: 0,
        scope: "repo",
        constraints: [],
        contract: testContract as any,
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
        },
        touchedFiles: [],
        failureCounts: {},
        verification: { required: false, satisfied: false, receipts: [] },
      },
      guard_enforcement_mode: "enforce",
    }
  })
  return session
}

async function transitionToRunning(runId: string) {
  await Transitions.transition(runId, "queued", "execution_queued")
  await Transitions.transition(runId, "running", "execution_started")
}

describe("Headless E2E Dummy Run", () => {
  test("full lifecycle: mutation -> block -> verify -> complete", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        // 1. Setup Build Session
        const session = await setupE2ESession("build", "Refactor dummy.ts")
        await transitionToRunning(session.id)

        // 2. Attempt Mutation
        await enforceRuntimeGuard({
          sessionID: session.id,
          toolID: "edit",
          callID: "call_1",
          req: {
            permission: "edit",
            patterns: ["src/dummy.ts"],
            always: ["*"],
            metadata: { filepath: "src/dummy.ts" },
          }
        })

        // The run mutated a file, so the log has to say so: touchedFiles in the
        // projection comes from mutation_recorded, and the completion proof reads
        // the projection.
        const { appendEventOnly: appendMutation } = await import("../../src/state/events/event-transitions")
        await appendMutation(session.id, "mutation_recorded", {
          receiptIds: ["mut_e2e_1"],
          changedPaths: ["src/dummy.ts"],
        })

        // 3. Record Artifact (required by completion proof for writes).
        // Through the log, not the legacy row: the projection is what the
        // completion gate reads.
        await RunLifecycle.addArtifact(session.id, "art_1")
        await Session.update(session.id, (draft) => {
          draft.state_v2 = {
            ...draft.state_v2,
            artifacts: [
              ...(draft.state_v2?.artifacts ?? []),
              {
                id: "art_1",
                kind: "file",
                path: "src/dummy.ts",
                metadata: {},
                created_at: Date.now(),
              },
            ],
          }
        })

        // 4. Attempt Completion (should block due to missing verification)
        await expect(Transitions.transition(session.id, "completed", "run_completed")).rejects.toThrow(/cannot complete without passing completion proof/)
        
        const approvals = await ApprovalStore.getApprovals(session.id)
        expect(approvals.some(a => a.type === "workflow_gate")).toBe(true)

        // 5. Record Verification Evidence
        await enforceRuntimeGuard({
          sessionID: session.id,
          toolID: "shell",
          callID: "call_2",
          req: {
            permission: "shell",
            patterns: ["bun test"],
            always: ["*"],
            metadata: {},
          }
        })

        // The guard records verification on its own state; the completion gate
        // reads the projection, so the evidence has to reach the log.
        const { appendEventOnly } = await import("../../src/state/events/event-transitions")
        await appendEventOnly(session.id, "verification_recorded", {
          status: "passed",
          receipts: [{ receiptId: "rcp_e2e_1" }],
          checks: [],
        })

        // 6. Success Path (should now complete)
        const finalState = await Transitions.transition(session.id, "completed", "run_completed")
        expect(finalState.status).toBe("completed")
        expect(finalState.governance.completionProof?.decision).toBe("pass")
      }
    })
  })

  test("negative lifecycle: mutation without verification stays blocked", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const session = await setupE2ESession("build", "Update dummy.ts")
        await transitionToRunning(session.id)

        await enforceRuntimeGuard({
          sessionID: session.id,
          toolID: "edit",
          callID: "call_neg_1",
          req: {
            permission: "edit",
            patterns: ["src/dummy.ts"],
            always: ["*"],
            metadata: { filepath: "src/dummy.ts" },
          }
        })

        // Stay blocked
        await expect(Transitions.transition(session.id, "completed", "run_completed")).rejects.toThrow()
        const state = await getProjectedRunState(session.id)
        expect(state?.status).toBe("running") // Still running because transition failed
      }
    })
  })
})
