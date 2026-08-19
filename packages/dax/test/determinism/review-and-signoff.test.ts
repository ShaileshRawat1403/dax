import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { rmSync, mkdirSync } from "fs"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { Instance } from "../../src/project/instance"
import { RunStore } from "../../src/state/run-store"
import { RunLifecycle as Transitions } from "../../src/state/run-lifecycle"
import { createEventAuthorityRun } from "../../src/state/events/event-transitions"
import { getProjectedRunState } from "../../src/state/events/run-event-store"
import { WorkflowRegistry } from "../../src/workflows/registry"
import { isFixedWorkflow, getStepsForWorkflow, REVIEW_AND_SIGNOFF_STEPS } from "../../src/workflows/types"
import { RunGateway } from "../../src/server/run-gateway"

describe("review_and_signoff workflow", () => {
  const testHome = path.join(os.tmpdir(), `dax-review-signoff-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {})
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(testHome, { recursive: true, force: true })
  })

  test("isFixedWorkflow returns true for review_and_signoff", () => {
    expect(isFixedWorkflow("review_and_signoff")).toBe(true)
  })

  test("getStepsForWorkflow returns correct steps for review_and_signoff", () => {
    const steps = getStepsForWorkflow("review_and_signoff")
    expect(steps).toHaveLength(4)
    expect(steps[0]?.stepId).toBe("collect_context")
    expect(steps[1]?.stepId).toBe("produce_review")
    expect(steps[2]?.stepId).toBe("request_signoff")
    expect(steps[3]?.stepId).toBe("finalize_outcome")
  })

  test("REVIEW_AND_SIGNOFF_STEPS constant has correct structure", () => {
    expect(REVIEW_AND_SIGNOFF_STEPS).toHaveLength(4)
    expect(REVIEW_AND_SIGNOFF_STEPS[0]).toMatchObject({
      stepId: "collect_context",
      type: "collect_context",
      title: "Collect Context",
      required: true,
    })
    expect(REVIEW_AND_SIGNOFF_STEPS[1]).toMatchObject({
      stepId: "produce_review",
      type: "produce_review",
      title: "Produce Review",
      required: true,
    })
    expect(REVIEW_AND_SIGNOFF_STEPS[2]).toMatchObject({
      stepId: "request_signoff",
      type: "request_signoff",
      title: "Request Signoff",
      required: true,
    })
    expect(REVIEW_AND_SIGNOFF_STEPS[3]).toMatchObject({
      stepId: "finalize_outcome",
      type: "finalize_outcome",
      title: "Finalize Outcome",
      required: true,
    })
  })

  test("WorkflowRegistry.create returns workflow instance for review_and_signoff", () => {
    const workflow = WorkflowRegistry.create("review_and_signoff", {
      runId: "test_run",
      contract: {
        schemaVersion: "v1" as const,
        contractId: "test_contract",
        runId: "test_run",
        workflowClass: "review_and_signoff",
        intent: "Review and approve changes",
        executionMode: "manual",
        riskLevel: "medium",
        toolAllowlist: [],
        toolBlocklist: [],
        approvalPolicy: { mode: "manual" },
        expectedOutputs: [],
        timeoutMs: 3600000,
        createdAt: new Date().toISOString(),
      },
    })

    expect(workflow).not.toBeNull()
  })

  test("review_and_signoff workflow executes successfully", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test review and signoff" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("review_and_signoff", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "review_and_signoff",
          intent: "Review and approve changes",
          executionMode: "manual",
          riskLevel: "medium",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash"],
          approvalPolicy: { mode: "manual" },
          expectedOutputs: [{ type: "report", description: "Review report" }],
          timeoutMs: 5000,
          createdAt: new Date().toISOString(),
        },
      })

      expect(workflow).not.toBeNull()

      const result = await workflow!.execute()

      expect(result.stepResults).toHaveLength(4)
      expect(result.finalArtifactId).toBeDefined()

      const runState = await getProjectedRunState(runId)
      expect(runState?.steps).toHaveLength(4)
      expect(runState?.steps[0]?.title).toBe("Collect Context")
      expect(runState?.steps[1]?.title).toBe("Produce Review")
      expect(runState?.steps[2]?.title).toBe("Request Signoff")
      expect(runState?.steps[3]?.title).toBe("Finalize Outcome")
    })
  }, 15000)

  test("review_and_signoff workflow records artifacts", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test review artifacts" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("review_and_signoff", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "review_and_signoff",
          intent: "Review and approve changes",
          executionMode: "manual",
          riskLevel: "medium",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash"],
          approvalPolicy: { mode: "manual" },
          expectedOutputs: [{ type: "report", description: "Review report" }],
          timeoutMs: 5000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow!.execute()

      const runState = await getProjectedRunState(runId)
      expect(runState?.artifactIds.length).toBeGreaterThan(0)
    })
  }, 15000)

  test("review_and_signoff workflow records all steps", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test review steps" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("review_and_signoff", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "review_and_signoff",
          intent: "Review and approve changes",
          executionMode: "manual",
          riskLevel: "medium",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash"],
          approvalPolicy: { mode: "manual" },
          expectedOutputs: [{ type: "report", description: "Review report" }],
          timeoutMs: 5000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow!.execute()

      const runState = await getProjectedRunState(runId)
      expect(runState?.steps).toHaveLength(4)
      expect(runState?.steps.every((s: { status: string }) => s.status === "completed")).toBe(true)
    })
  }, 15000)

  test("run gateway creates review_and_signoff run via execution contract", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const create = await RunGateway.createRun({
        intent: {
          input: "Review and approve these changes",
        },
        metadata: {
          source: "soothsayer" as const,
          initiatedBy: "test_user",
        },
      })

      const snapshot = await RunGateway.getSnapshot(create.runId)
      expect(snapshot.authority).toBe("dax-state-machine")

      const contract = (await Storage.read(["execution_contract", Instance.project.id, create.runId]).catch(
        () => undefined,
      )) as { workflowClass?: string } | undefined
      expect(contract?.workflowClass).toBe("review_and_signoff")
    })
  })

  test("replay produces same step order", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session1 = await Session.create({ title: "Test review replay 1" })
      const runId1 = session1.id

      await createEventAuthorityRun(runId1, "test_contract_id_1")
      await Transitions.transition(runId1, "queued", "execution_queued")
      await Transitions.transition(runId1, "running", "workflow_started")

      const workflow1 = WorkflowRegistry.create("review_and_signoff", {
        runId: runId1,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id_1",
          runId: runId1,
          workflowClass: "review_and_signoff",
          intent: "Review and approve changes",
          executionMode: "manual",
          riskLevel: "medium",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash"],
          approvalPolicy: { mode: "manual" },
          expectedOutputs: [{ type: "report", description: "Review report" }],
          timeoutMs: 5000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow1!.execute()

      const runState1 = await getProjectedRunState(runId1)
      const stepOrder1 = runState1!.steps.map((s: { stepId: string }) => s.stepId)
      const stepTitles1 = runState1!.steps.map((s: { title: string }) => s.title)

      expect(stepOrder1.length).toBe(4)
      expect(stepTitles1).toEqual(["Collect Context", "Produce Review", "Request Signoff", "Finalize Outcome"])

      const session2 = await Session.create({ title: "Test review replay 2" })
      const runId2 = session2.id

      await createEventAuthorityRun(runId2, "test_contract_id_2")
      await Transitions.transition(runId2, "queued", "execution_queued")
      await Transitions.transition(runId2, "running", "workflow_started")

      const workflow2 = WorkflowRegistry.create("review_and_signoff", {
        runId: runId2,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id_2",
          runId: runId2,
          workflowClass: "review_and_signoff",
          intent: "Review and approve changes",
          executionMode: "manual",
          riskLevel: "medium",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash"],
          approvalPolicy: { mode: "manual" },
          expectedOutputs: [{ type: "report", description: "Review report" }],
          timeoutMs: 5000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow2!.execute()

      const runState2 = await getProjectedRunState(runId2)
      const stepOrder2 = runState2!.steps.map((s: { stepId: string }) => s.stepId)
      const stepTitles2 = runState2!.steps.map((s: { title: string }) => s.title)

      expect(stepOrder1.length).toBe(stepOrder2.length)
      expect(stepTitles1).toEqual(stepTitles2)
    })
  }, 20000)
})
