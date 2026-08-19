import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { rmSync, mkdirSync } from "fs"
import {
  createEventAuthorityRun,
  transitionEventAuthority,
  addStepEvent,
  startStepEvent,
  completeStepEvent,
  addApprovalEvent,
  resolveApprovalEvent,
  addArtifactEvent,
  addDraftEvent,
  isEventAuthorityRun,
  getEventAuthorityState,
} from "../../src/state/events/event-transitions"
import { readRunEvents, getRunAuthority } from "../../src/state/events/run-event-store"
import { isEventAuthorityPilot } from "../../src/execution/run-factory"
import { compile } from "../../src/execution/compiler"
import { WorkerRunEffects, WorkerRunWorkflow } from "../../src/workflows/worker-run"

const CONTRACT_ID = "pilot-contract-001"

function makeRunId(suffix: number): string {
  return `pilot-${Date.now()}-${suffix}`
}

describe("event-authority pilot: draft_and_approve", () => {
  const testHome = path.join(os.tmpdir(), `dax-pilot-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    WorkerRunEffects.reset()
    if (previousHome) {
      process.env.DAX_TEST_HOME = previousHome
    } else {
      delete process.env.DAX_TEST_HOME
    }
    try {
      rmSync(testHome, { recursive: true, force: true })
    } catch (e) {}
  })

  test("every workflow class uses event authority, not just the pilot two", () => {
    // The pilot covered draft_and_approve and worker_run. The other three classes
    // wrote no run events at all, so replay, recovery and audit saw half the
    // runtime — and repo_analyze asserting false here was the shape of that gap.
    for (const workflowClass of [
      "draft_and_approve",
      "worker_run",
      "repo_analyze",
      "review_and_signoff",
      "generic",
    ]) {
      expect(isEventAuthorityPilot(workflowClass)).toBe(true)
    }
  })

  test("worker verification failure is evidenced and blocks the draft and approval gate", async () => {
    const runId = makeRunId(11)
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const { contract } = compile({
        request: {
          intent: { input: "Add a small helper with tests", repoPath: "/repo" },
          workflowHint: "worker_run",
          personaPreset: { personaId: "governed-worker", providerHint: "worker:claude" },
          workerConstraints: {
            writeScope: ["src/**", "test/**"],
            forbiddenPaths: ["package.json"],
            verification: ["bun test"],
          },
        },
      })
      contract.runId = runId
      contract.contractId = "worker-verification-contract"

      await createEventAuthorityRun(runId, contract.contractId)
      await transitionEventAuthority(runId, "queued", "execution_queued", {})
      await transitionEventAuthority(runId, "running", "workflow_started", {})

      WorkerRunEffects.set({
        async createCheckout() {
          return { path: "/tmp/worker-verification-checkout", cleanup: async () => {} }
        },
        async runWorker() {
          return { exitCode: 0, stdout: "done", stderr: "" }
        },
        async computeDiff() {
          return { content: "diff --git a/src/math.ts b/src/math.ts\n+export const isEven = () => true", changedPaths: ["src/math.ts"] }
        },
        async runVerification(check) {
          const now = new Date().toISOString()
          return {
            id: check.id,
            kind: "test",
            label: check.label,
            command: check.command,
            cwd: check.cwd,
            required: true,
            risk: "medium",
            exitCode: 1,
            status: "failed",
            startedAt: now,
            finishedAt: now,
            durationMs: 1,
            stdoutPreview: "",
            stderrPreview: "expected failure",
          }
        },
      })

      const workflow = new WorkerRunWorkflow({ runId, contract })
      const result = await workflow.execute()
      const state = await getEventAuthorityState(runId)
      const events = await readRunEvents(runId)

      expect(result.success).toBeFalse()
      expect(state?.status).toBe("failed")
      expect(state?.draft).toBeNull()
      expect(state?.pendingApprovalIds).toEqual([])
      expect(state?.governance.verification).toMatchObject({ required: true, satisfied: false })
      expect(state?.steps.some((step) => step.title === "Verify worker patch" && step.status === "failed")).toBeTrue()
      expect(events.some((event) => event.type === "verification_recorded")).toBeTrue()
    })
  })

  describe("Test 1: create event-authority run", () => {
    test("creates run with authority = event-log and initial event", async () => {
      const runId = makeRunId(1)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)

        const authority = await getRunAuthority(runId)
        expect(authority).toBe("event-log")

        const events = await readRunEvents(runId)
        expect(events).toHaveLength(1)
        expect(events[0].type).toBe("contract_compiled")
        expect(events[0].payload).toEqual({ contractId: CONTRACT_ID, verificationRequired: false })

        const state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("compiled")
        expect(state?.contractId).toBe(CONTRACT_ID)
      })
    })

    test("transitions to queued and running", async () => {
      const runId = makeRunId(2)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)

        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        let state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("queued")

        await transitionEventAuthority(runId, "running", "workflow_started", {})
        state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("running")
      })
    })
  })

  describe("Test 2: halt at approval", () => {
    test("workflow reaches approval_requested and halts", async () => {
      const runId = makeRunId(3)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_draft_001"
        await addStepEvent(runId, stepId, "Prepare Draft", "proposed")
        await startStepEvent(runId, stepId)
        await completeStepEvent(runId, stepId, ["draft:file"])

        const approvalId = "apr_pilot_001"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("waiting_approval")
        expect(state?.pendingApprovalIds).toContain(approvalId)
        expect(state?.currentStepId).toBeNull()
      })
    })
  })

  describe("Test 3: replay after restart (simulated)", () => {
    test("reconstructs waiting_approval from stored events only", async () => {
      const runId = makeRunId(4)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_draft_002"
        await addStepEvent(runId, stepId, "Prepare Draft", "proposed")
        await startStepEvent(runId, stepId)
        await completeStepEvent(runId, stepId, ["draft:file"])

        const approvalId = "apr_pilot_002"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const events = await readRunEvents(runId)
        expect(events).toHaveLength(7)

        const isEventRun = await isEventAuthorityRun(runId)
        expect(isEventRun).toBe(true)

        const projectedState = await getEventAuthorityState(runId)
        expect(projectedState?.status).toBe("waiting_approval")
        expect(projectedState?.pendingApprovalIds).toContain(approvalId)
        expect(projectedState?.contractId).toBe(CONTRACT_ID)
      })
    })
  })

  describe("Test 4: resume after approval", () => {
    test("approval_resolved restores running and workflow continues", async () => {
      const runId = makeRunId(5)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId1 = "step_draft_003"
        await addStepEvent(runId, stepId1, "Prepare Draft", "proposed")
        await startStepEvent(runId, stepId1)
        await completeStepEvent(runId, stepId1, ["draft:file"])

        const approvalId = "apr_pilot_003"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        let state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("waiting_approval")

        await resolveApprovalEvent(runId, approvalId, "approved")

        state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("running")
        expect(state?.pendingApprovalIds).toEqual([])

        const stepId2 = "step_commit_003"
        await addStepEvent(runId, stepId2, "Commit Execution", "proposed")
        await startStepEvent(runId, stepId2)

        const artifactId = "art_003"
        await addArtifactEvent(runId, artifactId, "file")
        await completeStepEvent(runId, stepId2, [artifactId])

        await transitionEventAuthority(runId, "completed", "run_completed", {})

        state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("completed")
        expect(state?.completedAt).not.toBeNull()
        expect(state?.artifactIds).toContain(artifactId)
      })
    })
  })

  describe("Test 5: legacy isolation", () => {
    test("legacy run is not affected by event-authority infrastructure", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const legacyRunId = "legacy-run-never-exists"

        const isEvent = await isEventAuthorityRun(legacyRunId)
        expect(isEvent).toBe(false)

        const state = await getEventAuthorityState(legacyRunId)
        expect(state).toBeNull()
      })
    })
  })

  describe("Full pilot flow", () => {
    test("complete draft_and_approve flow through event authority", async () => {
      const runId = makeRunId(100)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        expect(await isEventAuthorityRun(runId)).toBe(true)

        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const draftStepId = "step_full_draft"
        await addStepEvent(runId, draftStepId, "Prepare Draft", "proposed")
        await startStepEvent(runId, draftStepId)
        await completeStepEvent(runId, draftStepId, ["draft:file"])

        const approvalId = "apr_full_001"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        let state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("waiting_approval")

        await resolveApprovalEvent(runId, approvalId, "approved")

        state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("running")

        const commitStepId = "step_full_commit"
        await addStepEvent(runId, commitStepId, "Commit Execution", "proposed")
        await startStepEvent(runId, commitStepId)

        const artifactId = "art_full_001"
        await addArtifactEvent(runId, artifactId, "file")
        await completeStepEvent(runId, commitStepId, [artifactId])

        await transitionEventAuthority(runId, "completed", "run_completed", {})

        state = await getEventAuthorityState(runId)
        expect(state?.status).toBe("completed")
        expect(state?.steps).toHaveLength(2)
        expect(state?.artifactIds).toContain(artifactId)
        expect(state?.pendingApprovalIds).toEqual([])

        const events = await readRunEvents(runId)
        expect(events.map((e) => e.type)).toEqual([
          "contract_compiled",
          "execution_queued",
          "workflow_started",
          "step_added",
          "step_started",
          "step_completed",
          "approval_requested",
          "approval_resolved",
          "step_added",
          "step_started",
          "artifact_created",
          "step_completed",
          "run_completed",
        ])
      })
    })
  })

  describe("Draft artifact fidelity", () => {
    test("draft artifact is persisted with full fidelity and reconstructed on replay", async () => {
      const runId = makeRunId(200)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const draftId = "draft_fidelity_001"
        const draftContent = "This is the actual draft content that must be preserved"
        const draftTargetPath = "/path/to/target/file.txt"
        const draftType = "file"

        await addDraftEvent(runId, draftId, draftType, draftContent, draftTargetPath)

        const stateBeforeApproval = await getEventAuthorityState(runId)
        expect(stateBeforeApproval?.draft).toEqual({
          draftId,
          type: draftType,
          content: draftContent,
          targetPath: draftTargetPath,
        })

        const approvalId = "apr_fidelity_001"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        await resolveApprovalEvent(runId, approvalId, "approved")

        const stateAfterApproval = await getEventAuthorityState(runId)
        expect(stateAfterApproval?.status).toBe("running")
        expect(stateAfterApproval?.draft).toEqual({
          draftId,
          type: draftType,
          content: draftContent,
          targetPath: draftTargetPath,
        })

        const events = await readRunEvents(runId)
        const draftCreatedEvent = events.find((e) => e.type === "draft_created")
        expect(draftCreatedEvent).toBeDefined()
        expect((draftCreatedEvent?.payload as any).content).toBe(draftContent)
        expect((draftCreatedEvent?.payload as any).targetPath).toBe(draftTargetPath)
      })
    })

    test("reconstructs draft from events after simulated restart", async () => {
      const runId = makeRunId(201)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const draftId = "draft_replay_001"
        const draftContent = "Reconstructed draft content"
        const draftTargetPath = "/reconstructed/path.txt"
        await addDraftEvent(runId, draftId, "patch", draftContent, draftTargetPath)

        const approvalId = "apr_replay_001"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const projectedState = await getEventAuthorityState(runId)
        expect(projectedState?.status).toBe("waiting_approval")
        expect(projectedState?.draft?.content).toBe(draftContent)
        expect(projectedState?.draft?.targetPath).toBe(draftTargetPath)
        expect(projectedState?.draft?.type).toBe("patch")

        await resolveApprovalEvent(runId, approvalId, "approved")

        const resumedState = await getEventAuthorityState(runId)
        expect(resumedState?.status).toBe("running")
        expect(resumedState?.draft?.content).toBe(draftContent)
      })
    })
  })

  describe("Idempotency and retry safety", () => {
    test("resolveApprovalEvent is idempotent - repeated calls with same approvalId return same result", async () => {
      const runId = makeRunId(300)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const approvalId = "apr_idempotent_001"
        await addApprovalEvent(runId, approvalId)
        await transitionEventAuthority(runId, "waiting_approval", "approval_requested", { approvalId })

        const state1 = await resolveApprovalEvent(runId, approvalId, "approved")
        expect(state1?.status).toBe("running")
        expect(state1?.pendingApprovalIds).toEqual([])

        const events1 = await readRunEvents(runId)
        const resolutionEvents1 = events1.filter((e) => e.type === "approval_resolved")
        expect(resolutionEvents1).toHaveLength(1)

        const state2 = await resolveApprovalEvent(runId, approvalId, "approved")
        expect(state2?.status).toBe("running")
        expect(state2?.pendingApprovalIds).toEqual([])

        const events2 = await readRunEvents(runId)
        const resolutionEvents2 = events2.filter((e) => e.type === "approval_resolved")
        expect(resolutionEvents2).toHaveLength(1)

        expect(events1.length).toBe(events2.length)
      })
    })

    test("step operations are idempotent - repeated step start does not duplicate", async () => {
      const runId = makeRunId(301)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_idempotent_001"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)

        const events1 = await readRunEvents(runId)
        const startEvents1 = events1.filter((e) => e.type === "step_started")
        expect(startEvents1).toHaveLength(1)

        await startStepEvent(runId, stepId)

        const events2 = await readRunEvents(runId)
        const startEvents2 = events2.filter((e) => e.type === "step_started")
        expect(startEvents2).toHaveLength(1)

        expect(events1.length).toBe(events2.length)
      })
    })

    test("completeStepEvent is idempotent - repeated completion does not duplicate", async () => {
      const runId = makeRunId(302)
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await createEventAuthorityRun(runId, CONTRACT_ID)
        await transitionEventAuthority(runId, "queued", "execution_queued", {})
        await transitionEventAuthority(runId, "running", "workflow_started", {})

        const stepId = "step_complete_001"
        await addStepEvent(runId, stepId, "Test Step", "proposed")
        await startStepEvent(runId, stepId)
        await completeStepEvent(runId, stepId, ["output1"])

        const events1 = await readRunEvents(runId)
        const completeEvents1 = events1.filter((e) => e.type === "step_completed")
        expect(completeEvents1).toHaveLength(1)

        await completeStepEvent(runId, stepId, ["output1"])

        const events2 = await readRunEvents(runId)
        const completeEvents2 = events2.filter((e) => e.type === "step_completed")
        expect(completeEvents2).toHaveLength(1)

        expect(events1.length).toBe(events2.length)
      })
    })
  })
})
