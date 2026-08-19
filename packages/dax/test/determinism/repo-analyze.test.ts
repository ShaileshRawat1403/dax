import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { createEventAuthorityRun } from "../../src/state/events/event-transitions"
import { getProjectedRunState } from "../../src/state/events/run-event-store"
import os from "os"
import path from "path"
import { rmSync, mkdirSync } from "fs"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { Instance } from "../../src/project/instance"
import { RunStore } from "../../src/state/run-store"
import { RunLifecycle as Transitions } from "../../src/state/run-lifecycle"
import { WorkflowRegistry } from "../../src/workflows/registry"
import { compile } from "../../src/execution/compiler"
import { isFixedWorkflow, getStepsForWorkflow, REPO_ANALYZE_STEPS } from "../../src/workflows/types"
import { RunGateway } from "../../src/server/run-gateway"

describe("repo_analyze workflow", () => {
  const testHome = path.join(os.tmpdir(), `dax-repo-analyze-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {})
  }, 30000)

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(testHome, { recursive: true, force: true })
  }, 30000)

  test("isFixedWorkflow returns true for repo_analyze", () => {
    expect(isFixedWorkflow("repo_analyze")).toBe(true)
  })

  test("getStepsForWorkflow returns correct steps for repo_analyze", () => {
    const steps = getStepsForWorkflow("repo_analyze")
    expect(steps).toHaveLength(3)
    expect(steps[0]?.stepId).toBe("collect_context")
    expect(steps[1]?.stepId).toBe("analyze_repository")
    expect(steps[2]?.stepId).toBe("publish_report")
  })

  test("REPO_ANALYZE_STEPS constant has correct structure", () => {
    expect(REPO_ANALYZE_STEPS).toHaveLength(3)
    expect(REPO_ANALYZE_STEPS[0]).toMatchObject({
      stepId: "collect_context",
      type: "collect_context",
      title: "Collect Context",
      required: true,
    })
    expect(REPO_ANALYZE_STEPS[1]).toMatchObject({
      stepId: "analyze_repository",
      type: "analyze_repository",
      title: "Analyze Repository",
      required: true,
    })
    expect(REPO_ANALYZE_STEPS[2]).toMatchObject({
      stepId: "publish_report",
      type: "publish_report",
      title: "Publish Report",
      required: true,
    })
  })

  test("compile classifies analyze intent as repo_analyze", () => {
    const result = compile({
      request: {
        intent: { input: "Analyze the repository structure and find patterns" },
      },
    })

    expect(result.contract.workflowClass).toBe("repo_analyze")
  })

  test("compile classifies explore intent as repo_analyze", () => {
    const result = compile({
      request: {
        intent: { input: "Explore the codebase to understand the architecture" },
      },
    })

    expect(result.contract.workflowClass).toBe("repo_analyze")
  })

  test("compile classifies understand intent as repo_analyze", () => {
    const result = compile({
      request: {
        intent: { input: "Help me understand this codebase" },
      },
    })

    expect(result.contract.workflowClass).toBe("repo_analyze")
  })

  test("compile derives low risk level for read-only intents", () => {
    const result = compile({
      request: {
        intent: { input: "Analyze repository structure" },
      },
    })

    expect(result.contract.riskLevel).toBe("low")
  })

  test("compile derives auto execution mode for repo_analyze", () => {
    const result = compile({
      request: {
        intent: { input: "Analyze repository structure" },
      },
    })

    expect(result.contract.executionMode).toBe("auto")
  })

  test("compile includes report in expected outputs for repo_analyze", () => {
    const result = compile({
      request: {
        intent: { input: "Analyze repository and generate findings" },
      },
    })

    expect(result.contract.expectedOutputs.some((o: { type: string }) => o.type === "report")).toBe(true)
  })

  test("repo_analyze blocks write and shell tools", () => {
    const result = compile({
      request: {
        intent: { input: "Analyze repository" },
        availableTools: ["read", "write", "edit", "glob", "grep", "bash", "shell"],
      },
    })

    expect(result.contract.toolBlocklist).toContain("write")
    expect(result.contract.toolBlocklist).toContain("edit")
    expect(result.contract.toolBlocklist).toContain("apply_patch")
    expect(result.contract.toolBlocklist).toContain("multiedit")
    // "patch"/"apply" were phantom ids; the blocklist now carries the real edit tools.
    expect(result.contract.toolBlocklist).not.toContain("apply")
    expect(result.contract.toolBlocklist).toContain("bash")
    expect(result.contract.toolBlocklist).toContain("shell")
  })

  test("workflow registry creates repo_analyze workflow", () => {
    const workflow = WorkflowRegistry.create("repo_analyze", {
      runId: "test_run",
      contract: {
        schemaVersion: "v1" as const,
        contractId: "test",
        runId: "test_run",
        workflowClass: "repo_analyze",
        intent: "Analyze repository",
        executionMode: "auto",
        riskLevel: "low",
        toolAllowlist: ["read", "glob", "grep"],
        toolBlocklist: ["write", "edit"],
        approvalPolicy: { mode: "auto" },
        expectedOutputs: [],
        timeoutMs: 1800000,
        createdAt: new Date().toISOString(),
      },
    })

    expect(workflow).not.toBeNull()
  })

  test("repo_analyze workflow executes successfully", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test repo analyze" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "compiled", "contract_compiled")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("repo_analyze", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "repo_analyze",
          intent: "Analyze the repository structure",
          executionMode: "auto",
          riskLevel: "low",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash", "shell"],
          approvalPolicy: { mode: "auto" },
          expectedOutputs: [{ type: "report", description: "Analysis report" }],
          timeoutMs: 1800000,
          createdAt: new Date().toISOString(),
        },
      })

      expect(workflow).not.toBeNull()

      const result = await workflow!.execute()

      expect(result.success).toBe(true)
      expect(result.stepResults).toHaveLength(3)
      expect(result.stepResults.every((r: { success: boolean }) => r.success)).toBe(true)
      expect(result.finalArtifactId).toBeDefined()

      const runState = await getProjectedRunState(runId)
      expect(runState?.status).toBe("completed")
      expect(runState?.steps[0]?.title).toBe("Collect Context")
      expect(runState?.steps[1]?.title).toBe("Analyze Repository")
      expect(runState?.steps[2]?.title).toBe("Publish Report")
    })
  })

  test("repo_analyze workflow records artifacts", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test repo analyze artifacts" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "compiled", "contract_compiled")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("repo_analyze", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "repo_analyze",
          intent: "Analyze the repository structure",
          executionMode: "auto",
          riskLevel: "low",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash", "shell"],
          approvalPolicy: { mode: "auto" },
          expectedOutputs: [{ type: "report", description: "Analysis report" }],
          timeoutMs: 1800000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow!.execute()

      const runState = await getProjectedRunState(runId)
      expect(runState?.artifactIds.length).toBeGreaterThan(0)
    })
  })

  test("repo_analyze workflow records all steps", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session = await Session.create({ title: "Test repo analyze steps" })
      const runId = session.id

      await createEventAuthorityRun(runId, "test_contract_id")
      await Transitions.transition(runId, "compiled", "contract_compiled")
      await Transitions.transition(runId, "queued", "execution_queued")
      await Transitions.transition(runId, "running", "workflow_started")

      const workflow = WorkflowRegistry.create("repo_analyze", {
        runId,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id",
          runId,
          workflowClass: "repo_analyze",
          intent: "Analyze the repository structure",
          executionMode: "auto",
          riskLevel: "low",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash", "shell"],
          approvalPolicy: { mode: "auto" },
          expectedOutputs: [{ type: "report", description: "Analysis report" }],
          timeoutMs: 1800000,
          createdAt: new Date().toISOString(),
        },
      })

      await workflow!.execute()

      const runState = await getProjectedRunState(runId)
      expect(runState?.steps).toHaveLength(3)
      expect(runState?.steps[0].title).toBe("Collect Context")
      expect(runState?.steps[1].title).toBe("Analyze Repository")
      expect(runState?.steps[2].title).toBe("Publish Report")
      expect(runState?.steps.every((s: { status: string }) => s.status === "completed")).toBe(true)
    })
  })

  test("run gateway creates repo_analyze run via execution contract", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const create = await RunGateway.createRun({
        intent: {
          input: "Analyze the repository structure",
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
      expect(contract?.workflowClass).toBe("repo_analyze")
    })
  })

  test("replay produces same step order", async () => {
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
      const session1 = await Session.create({ title: "Test repo analyze replay 1" })
      const runId1 = session1.id

      await createEventAuthorityRun(runId1, "test_contract_id_1")
      await Transitions.transition(runId1, "compiled", "contract_compiled")
      await Transitions.transition(runId1, "queued", "execution_queued")
      await Transitions.transition(runId1, "running", "workflow_started")

      const workflow1 = WorkflowRegistry.create("repo_analyze", {
        runId: runId1,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id_1",
          runId: runId1,
          workflowClass: "repo_analyze",
          intent: "Analyze the repository structure",
          executionMode: "auto",
          riskLevel: "low",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash", "shell"],
          approvalPolicy: { mode: "auto" },
          expectedOutputs: [{ type: "report", description: "Analysis report" }],
          timeoutMs: 1800000,
          createdAt: new Date().toISOString(),
        },
      })

      const result1 = await workflow1!.execute()

      const runState1 = await getProjectedRunState(runId1)
      const stepOrder1 = runState1!.steps.map((s: { stepId: string }) => s.stepId)
      const stepTitles1 = runState1!.steps.map((s: { title: string }) => s.title)

      expect(stepOrder1.length).toBe(3)
      expect(stepTitles1).toEqual(["Collect Context", "Analyze Repository", "Publish Report"])
      expect(result1.success).toBe(true)
      expect(result1.stepResults.every((r: { success: boolean }) => r.success)).toBe(true)

      const session2 = await Session.create({ title: "Test repo analyze replay 2" })
      const runId2 = session2.id

      await createEventAuthorityRun(runId2, "test_contract_id_2")
      await Transitions.transition(runId2, "compiled", "contract_compiled")
      await Transitions.transition(runId2, "queued", "execution_queued")
      await Transitions.transition(runId2, "running", "workflow_started")

      const workflow2 = WorkflowRegistry.create("repo_analyze", {
        runId: runId2,
        contract: {
          schemaVersion: "v1" as const,
          contractId: "test_contract_id_2",
          runId: runId2,
          workflowClass: "repo_analyze",
          intent: "Analyze the repository structure",
          executionMode: "auto",
          riskLevel: "low",
          toolAllowlist: ["read", "glob", "grep"],
          toolBlocklist: ["write", "edit", "bash", "shell"],
          approvalPolicy: { mode: "auto" },
          expectedOutputs: [{ type: "report", description: "Analysis report" }],
          timeoutMs: 1800000,
          createdAt: new Date().toISOString(),
        },
      })

      const result2 = await workflow2!.execute()

      const runState2 = await getProjectedRunState(runId2)
      const stepOrder2 = runState2!.steps.map((s: { stepId: string }) => s.stepId)
      const stepTitles2 = runState2!.steps.map((s: { title: string }) => s.title)

      expect(stepOrder1.length).toBe(stepOrder2.length)
      expect(stepTitles1).toEqual(stepTitles2)
      expect(result1.success).toBe(result2.success)
    })
  })
})
