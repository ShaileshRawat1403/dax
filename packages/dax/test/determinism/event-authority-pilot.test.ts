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
  isEventAuthorityRun,
  getEventAuthorityState,
} from "../../src/state/events/event-transitions"
import { readRunEvents, getRunAuthority } from "../../src/state/events/run-event-store"

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
    if (previousHome) {
      process.env.DAX_TEST_HOME = previousHome
    } else {
      delete process.env.DAX_TEST_HOME
    }
    try {
      rmSync(testHome, { recursive: true, force: true })
    } catch (e) {}
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
        expect(events[0].payload).toEqual({ contractId: CONTRACT_ID })

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
})
