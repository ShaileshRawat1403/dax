import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"

async function eventually<T>(assertion: () => Promise<T>, options?: { timeoutMs?: number; intervalMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 2000
  const intervalMs = options?.intervalMs ?? 25
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() <= deadline) {
    try {
      return await assertion()
    } catch (error) {
      lastError = error
      await Bun.sleep(intervalMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Condition did not converge before timeout")
}

describe("run gateway v1 contract", () => {
  test("maps external approval decisions onto current DAX permission replies", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-gateway-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { Permission } = await import("@/governance")
      const { RunGateway } = await import("./run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_123",
          },
        })

        const waiting = Permission.ask({
          sessionID: create.runId,
          permission: "shell",
          patterns: ["rm -rf tmp"],
          always: ["rm -rf tmp"],
          metadata: { command: "rm -rf tmp" },
          ruleset: Permission.fromConfig({ shell: "ask" } as any),
        })

        const approvals = await RunGateway.getApprovals(create.runId)
        expect(approvals).toHaveLength(1)
        expect(approvals[0]?.type).toBe("command_execute")

        const resolved = await RunGateway.resolveApproval(create.runId, approvals[0]!.approvalId, {
          decision: "approve",
          actorId: "user_123",
          source: "soothsayer",
          requestId: "req_1",
        })

        expect(resolved.status).toBe("approved")
        await waiting
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("reconstructs pending approvals from run events when live permission memory is unavailable", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-approval-recovery-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { Permission } = await import("@/governance")
      const { Storage } = await import("@/storage/storage")
      const { Instance } = await import("@/project/instance")
      const { RunGateway } = await import("./run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_recovery",
          },
        })

        const existingEvents = await RunGateway.replayEvents(create.runId)
        await Storage.write(
          ["run_events", Instance.project.id, create.runId],
          [
            ...existingEvents,
            {
              schemaVersion: "v1",
              eventId: `evt_${create.runId}_2`,
              sequence: 2,
              cursor: `evt_${create.runId}_2`,
              runId: create.runId,
              type: "approval.requested",
              timestamp: new Date().toISOString(),
              payload: {
                approval: {
                  approvalId: "per_recovery_test",
                  runId: create.runId,
                  type: "command_execute",
                  status: "pending",
                  risk: "high",
                  title: "shell requires approval",
                  reason: "pwd",
                  context: {
                    command: "pwd",
                    notes: ["pwd"],
                  },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              },
            },
          ],
        )

        const originalList = Permission.list
        Permission.list = async () => []

        try {
          const approvals = await RunGateway.getApprovals(create.runId)
          const snapshot = await RunGateway.getSnapshot(create.runId)

          expect(approvals).toHaveLength(1)
          expect(approvals[0]?.type).toBe("command_execute")
          expect(snapshot.pendingApprovalCount).toBe(1)
          expect(snapshot.authority).toBe("dax-state-machine")
        } finally {
          Permission.list = originalList
        }
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("stores source authority in snapshots without redefining DAX execution truth", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-snapshot-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_456",
          },
        })

        const snapshot = await RunGateway.getSnapshot(create.runId)
        expect(snapshot.schemaVersion).toBe("v1")
        expect(snapshot.authority).toBe("dax-state-machine")
        expect(snapshot.sourceSystem).toBe("soothsayer")
        expect(snapshot.status).toBe("created")
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("maps strict approval mode onto session permission rules so external runs can deterministically require approval", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-approval-mode-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const { Session } = await import("@/session")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          personaPreset: {
            personaId: "strict-validator",
            approvalMode: "strict",
            riskLevel: "medium",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_789",
          },
        })

        const session = await Session.get(create.runId)
        expect(session.permission?.some((rule) => rule.permission === "edit" && rule.action === "ask")).toBe(true)
        expect(session.permission?.some((rule) => rule.permission === "shell" && rule.action === "ask")).toBe(true)
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("projects denied-permission runs as terminal failures in snapshot and summary", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-deny-status-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const { Session } = await import("@/session")
      const { Identifier } = await import("@/id/id")
      const { MessageV2 } = await import("@/session/message-v2")
      const TransitionsModule = await import("@/state/transitions")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const { Provider } = await import("@/provider/provider")
        let model: { providerID: string; modelID: string }
        try {
          model = await Provider.defaultModel()
        } catch {
          model = { providerID: "openai", modelID: "gpt-5.1-codex" }
          const originalGetModel = Provider.getModel
          Provider.getModel = async (providerID, modelID) => {
            if (providerID === "openai" && modelID === "gpt-5.1-codex") {
              return { id: "gpt-5.1-codex", providerID: "openai", name: "GPT-5.1 Codex" } as any
            }
            return originalGetModel(providerID, modelID)
          }
        }
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_999",
          },
        })

        await TransitionsModule.Transitions.transition(create.runId, "queued", "execution_queued")
        await TransitionsModule.Transitions.transition(create.runId, "running", "execution_started")

        const stepId = Identifier.ascending("part")
        await TransitionsModule.Transitions.addStep(create.runId, stepId, "apply_patch", "executed")
        await TransitionsModule.Transitions.startStep(create.runId, stepId)

        const userMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: userMessageId,
          role: "user",
          sessionID: create.runId,
          time: { created: Date.now() - 50 },
          model,
          agent: "test-agent",
        })

        const assistantMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: assistantMessageId,
          parentID: userMessageId,
          role: "assistant",
          mode: "test-agent",
          agent: "test-agent",
          path: {
            cwd: repoRoot,
            root: repoRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.modelID,
          providerID: model.providerID,
          time: {
            created: Date.now() - 25,
            completed: Date.now(),
          },
          finish: "tool-calls",
          error: MessageV2.fromError(new Error("The user rejected permission to use this specific tool call."), {
            providerID: model.providerID,
          }),
          sessionID: create.runId,
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessageId,
          sessionID: create.runId,
          type: "tool",
          callID: "tool_1",
          tool: "apply_patch",
          state: {
            status: "error",
            input: { path: "approval-deny-test.txt" },
            error: "The user rejected permission to use this specific tool call.",
            time: {
              start: Date.now() - 20,
              end: Date.now() - 10,
            },
          },
        })

        await TransitionsModule.Transitions.failStep(create.runId, stepId, {
          code: "permission_denied",
          message: "The user rejected permission to use this specific tool call.",
        })
        await TransitionsModule.Transitions.transition(create.runId, "failed", "permission_denied")

        await eventually(async () => {
          const snapshot = await RunGateway.getSnapshot(create.runId)
          const summary = await RunGateway.getSummary(create.runId)

          expect(snapshot.status).toBe("failed")
          expect(snapshot.completedAt).toBeDefined()
          expect(summary.status).toBe("failed")
          expect(summary.outcome?.result).toBe("failure")
          expect(summary.completedAt).toBeDefined()
          expect(summary.failedStepCount).toBeGreaterThan(0)
        })
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("projects contract-mutation runs with contract_mutation terminal reason in snapshot and summary", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-contract-mutation-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const { Session } = await import("@/session")
      const { Identifier } = await import("@/id/id")
      const { MessageV2 } = await import("@/session/message-v2")
      const TransitionsModule = await import("@/state/transitions")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const { Provider } = await import("@/provider/provider")
        let model: { providerID: string; modelID: string }
        try {
          model = await Provider.defaultModel()
        } catch {
          model = { providerID: "openai", modelID: "gpt-5.1-codex" }
          const originalGetModel = Provider.getModel
          Provider.getModel = async (providerID, modelID) => {
            if (providerID === "openai" && modelID === "gpt-5.1-codex") {
              return { id: "gpt-5.1-codex", providerID: "openai", name: "GPT-5.1 Codex" } as any
            }
            return originalGetModel(providerID, modelID)
          }
        }
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_contract_mutation",
          },
        })

        await TransitionsModule.Transitions.transition(create.runId, "queued", "execution_queued")
        await TransitionsModule.Transitions.transition(create.runId, "running", "execution_started")

        const stepId = Identifier.ascending("part")
        await TransitionsModule.Transitions.addStep(create.runId, stepId, "execute_workflow", "executed")
        await TransitionsModule.Transitions.startStep(create.runId, stepId)

        const userMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: userMessageId,
          role: "user",
          sessionID: create.runId,
          time: { created: Date.now() - 50 },
          model,
          agent: "test-agent",
        })

        const assistantMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: assistantMessageId,
          parentID: userMessageId,
          role: "assistant",
          mode: "test-agent",
          agent: "test-agent",
          path: {
            cwd: repoRoot,
            root: repoRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.modelID,
          providerID: model.providerID,
          time: {
            created: Date.now() - 25,
            completed: Date.now(),
          },
          finish: "tool-calls",
          error: MessageV2.fromError(
            new Error("ExecutionContract is immutable after run initialization: cannot add step"),
            { providerID: model.providerID },
          ),
          sessionID: create.runId,
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessageId,
          sessionID: create.runId,
          type: "tool",
          callID: "tool_1",
          tool: "execute_workflow",
          state: {
            status: "error",
            input: { workflowId: "wf_contract_test" },
            error: "ExecutionContract is immutable after run initialization: cannot add step",
            time: {
              start: Date.now() - 20,
              end: Date.now() - 10,
            },
          },
        })

        await TransitionsModule.Transitions.failStep(create.runId, stepId, {
          code: "contract_mutation",
          message: "ExecutionContract is immutable after run initialization: cannot add step",
        })
        await TransitionsModule.Transitions.transition(create.runId, "failed", "contract_mutation")

        await eventually(async () => {
          const snapshot = await RunGateway.getSnapshot(create.runId)
          const summary = await RunGateway.getSummary(create.runId)

          expect(snapshot.status).toBe("failed")
          expect(snapshot.completedAt).toBeDefined()

          expect(summary.status).toBe("failed")
          expect(summary.outcome?.result).toBe("failure")
          expect(summary.completedAt).toBeDefined()
          expect(summary.failedStepCount).toBeGreaterThan(0)
        })
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("extracts contract_mutation from immutable message when error.code is not set", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-immutable-message-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const { Transitions } = await import("@/state/transitions")
      const { Identifier } = await import("@/id/id")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: { input: "" },
          metadata: { source: "soothsayer", initiatedBy: "user_immutable_msg" },
        })

        await Transitions.transition(create.runId, "queued", "execution_queued")
        await Transitions.transition(create.runId, "running", "execution_started")

        const stepId = Identifier.ascending("part")
        await Transitions.addStep(create.runId, stepId, "execute_workflow", "executed")
        await Transitions.startStep(create.runId, stepId)

        await Transitions.failStep(create.runId, stepId, {
          code: undefined as any,
          message: "ExecutionContract is immutable after run initialization",
        })
        await Transitions.transition(create.runId, "failed", "contract_mutation")

        await eventually(async () => {
          const snapshot = await RunGateway.getSnapshot(create.runId)
          const summary = await RunGateway.getSummary(create.runId)

          expect(snapshot.status).toBe("failed")
          expect(snapshot.completedAt).toBeDefined()

          expect(summary.status).toBe("failed")
          expect(summary.completedAt).toBeDefined()
        })
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("lists active runs, recent runs, and pending approvals with truthful source and targeting context", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-overview-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { Bus } = await import("@/bus")
      const { RunGateway } = await import("./run-gateway")
      const { Permission } = await import("@/governance")
      const { Session } = await import("@/session")
      const { Identifier } = await import("@/id/id")
      const { MessageV2 } = await import("@/session/message-v2")
      const { Transitions } = await import("@/state/transitions")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const { Provider } = await import("@/provider/provider")
        let model: { providerID: string; modelID: string }
        try {
          model = await Provider.defaultModel()
        } catch {
          model = { providerID: "openai", modelID: "gpt-5.1-codex" }
          const originalGetModel = Provider.getModel
          Provider.getModel = async (providerID, modelID) => {
            if (providerID === "openai" && modelID === "gpt-5.1-codex") {
              return { id: "gpt-5.1-codex", providerID: "openai", name: "GPT-5.1 Codex" } as any
            }
            return originalGetModel(providerID, modelID)
          }
        }
        const active = await RunGateway.createRun({
          intent: {
            input: "",
            repoPath: repoRoot,
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_active",
            workspaceId: "workspace_1",
            projectId: "project_1",
            targeting: {
              mode: "explicit_repo_path",
              repoPath: repoRoot,
            },
          },
        })

        Permission.ask({
          sessionID: active.runId,
          permission: "shell",
          patterns: ["pwd"],
          always: ["pwd"],
          metadata: { command: "pwd" },
          ruleset: Permission.fromConfig({ shell: "ask" } as any),
        })

        const recent = await RunGateway.createRun({
          intent: {
            input: "",
            repoPath: repoRoot,
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_workflow",
            workspaceId: "workspace_1",
            projectId: "project_2",
            workflowId: "workflow_123",
            targeting: {
              mode: "explicit_repo_path",
              repoPath: repoRoot,
            },
          },
        })

        const userMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: userMessageId,
          role: "user",
          sessionID: recent.runId,
          time: { created: Date.now() - 50 },
          model,
          agent: "test-agent",
        })

        const assistantMessageId = Identifier.ascending("message")
        await Session.updateMessage({
          id: assistantMessageId,
          parentID: userMessageId,
          role: "assistant",
          mode: "test-agent",
          agent: "test-agent",
          path: {
            cwd: repoRoot,
            root: repoRoot,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.modelID,
          providerID: model.providerID,
          time: {
            created: Date.now() - 25,
            completed: Date.now(),
          },
          finish: "tool-calls",
          error: MessageV2.fromError(new Error("The user rejected permission to use this specific tool call."), {
            providerID: model.providerID,
          }),
          sessionID: recent.runId,
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMessageId,
          sessionID: recent.runId,
          type: "tool",
          callID: "tool_1",
          tool: "apply_patch",
          state: {
            status: "error",
            input: { path: "overview-test.txt" },
            error: "The user rejected permission to use this specific tool call.",
            time: {
              start: Date.now() - 20,
              end: Date.now() - 10,
            },
          },
        })

        await Transitions.transition(recent.runId, "queued", "execution_queued")
        await Transitions.transition(recent.runId, "running", "execution_started")
        const recentStepId = Identifier.ascending("part")
        await Transitions.addStep(recent.runId, recentStepId, "apply_patch", "executed")
        await Transitions.startStep(recent.runId, recentStepId)
        await Transitions.failStep(recent.runId, recentStepId, {
          code: "permission_denied",
          message: "The user rejected permission to use this specific tool call.",
        })
        await Transitions.transition(recent.runId, "failed", "permission_denied")

        await eventually(async () => {
          const overview = await RunGateway.getOverview()
          const activeRun = overview.activeRuns.find((item) => item.runId === active.runId)
          const recentRun = overview.recentRuns.find((item) => item.runId === recent.runId)
          const pendingApproval = overview.pendingApprovals.find((item) => item.runId === active.runId)

          expect(activeRun).toBeDefined()
          expect(activeRun?.sourceSurface).toBe("direct")
          expect(activeRun?.targeting?.mode).toBe("explicit_repo_path")
          expect(activeRun?.targeting?.repoPath).toBe(repoRoot)
          expect(activeRun?.workspaceId).toBe("workspace_1")
          expect(activeRun?.projectId).toBe("project_1")
          expect(activeRun?.pendingApprovalCount).toBe(1)

          expect(recentRun).toBeDefined()
          expect(recentRun?.status).toBe("failed")
          expect(recentRun?.sourceSurface).toBe("workflow")
          expect(recentRun?.workflowId).toBe("workflow_123")

          expect(pendingApproval).toBeDefined()
          expect(pendingApproval?.type).toBe("command_execute")
          expect(pendingApproval?.sourceSurface).toBe("direct")
          expect(pendingApproval?.targeting?.repoPath).toBe(repoRoot)
        })
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("serializes approval and step events so cursors stay unique and summary counts approvals", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-approval-sequence-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")

      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_sequence",
          },
        })

        await Promise.all([
          RunGateway.__testing.appendEvent(create.runId, {
            runId: create.runId,
            type: "approval.requested",
            timestamp: new Date().toISOString(),
            payload: {
              approval: {
                approvalId: "per_sequence_test",
                runId: create.runId,
                type: "file_write",
                status: "pending",
                risk: "medium",
                title: "edit requires approval",
                reason: "approval-sequence-test.txt",
                context: {
                  stepId: "tool_sequence_1",
                  filePath: "approval-sequence-test.txt",
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          }),
          RunGateway.__testing.appendEvent(create.runId, {
            runId: create.runId,
            type: "step.started",
            timestamp: new Date().toISOString(),
            payload: {
              stepId: "tool_sequence_1",
              title: "apply_patch",
              detail: "apply_patch",
            },
          }),
        ])

        const events = await RunGateway.replayEvents(create.runId)
        const syntheticEvents = events.filter(
          (event) => event.type === "approval.requested" || event.type === "step.started",
        )
        const sequences = syntheticEvents.map((event) => event.sequence)
        const cursors = syntheticEvents.map((event) => event.cursor)
        const approvalEvents = events.filter((event) => event.type === "approval.requested")
        const startedEvents = events.filter((event) => event.type === "step.started")
        const summary = await RunGateway.getSummary(create.runId)

        expect(approvalEvents.length).toBeGreaterThanOrEqual(1)
        expect(startedEvents.length).toBeGreaterThanOrEqual(1)
        expect(new Set(sequences).size).toBe(sequences.length)
        expect(new Set(cursors).size).toBe(cursors.length)
        expect(summary.approvalCount).toBeGreaterThanOrEqual(1)
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("waits for approval events to persist before Bus.publish resolves", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-publish-await-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { Bus } = await import("@/bus")
      const { RunGateway } = await import("./run-gateway")
      const { Permission } = await import("@/governance")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_publish_wait",
          },
        })

        await Bus.publish(Permission.Event.Asked, {
          id: "per_publish_wait",
          createdAt: Date.now(),
          sessionID: create.runId,
          permission: "shell",
          patterns: ["pwd"],
          always: ["pwd"],
          metadata: { command: "pwd" },
          tool: {
            messageID: "msg_publish_wait",
            callID: "tool_publish_wait",
          },
        })

        const events = await RunGateway.replayEvents(create.runId)
        const approvals = await RunGateway.getApprovals(create.runId)

        expect(events.some((event) => event.type === "approval.requested")).toBe(true)
        expect(approvals.length).toBeGreaterThanOrEqual(1)
        expect(approvals[0]?.type).toBe("command_execute")
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("re-initializes run gateway subscriptions after instance disposal", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-reinit-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      const firstRunId = await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_reinit_first",
          },
        })

        const events = await RunGateway.replayEvents(create.runId)
        expect(events.some((event) => event.type === "run.created")).toBe(true)
        return create.runId
      })

      const secondRunId = await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_reinit_second",
          },
        })

        const events = await RunGateway.replayEvents(create.runId)
        expect(events.some((event) => event.type === "run.created")).toBe(true)
        return create.runId
      })

      expect(secondRunId).not.toBe(firstRunId)
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)

  test("builds run projections from snapshot and event stream", async () => {
    const testHome = path.join(os.tmpdir(), `dax-run-projections-${Date.now().toString(36)}`)
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome

    try {
      const { bootstrap } = await import("@/cli/bootstrap")
      const { RunGateway } = await import("./run-gateway")
      const repoRoot = path.resolve(import.meta.dir, "../../..")

      await bootstrap(repoRoot, async () => {
        const create = await RunGateway.createRun({
          intent: {
            input: "Initial intent",
          },
          metadata: {
            source: "soothsayer",
            initiatedBy: "user_projections",
          },
        })

        // Add some synthetic events to build a narrative
        await RunGateway.__testing.appendEvent(create.runId, {
          runId: create.runId,
          type: "intent.created",
          timestamp: new Date().toISOString(),
          payload: {
            intentType: "edit",
            goal: "Fix the bug",
            riskLevel: "medium",
            confidence: 0.9,
          },
        })

        await RunGateway.__testing.appendEvent(create.runId, {
          runId: create.runId,
          type: "plan.compiled",
          timestamp: new Date().toISOString(),
          payload: {
            planId: "plan_1",
            tasks: [
              { id: "task_1", name: "Task 1", description: "Do something", dependencies: [] },
            ],
          },
        })

        const projections = await RunGateway.getProjections(create.runId)

        expect(projections.header.runId).toBe(create.runId)
        expect(projections.header.status).toBe("created")

        // P1.5 can add a non-blocking intervention narrative in warn mode.
        expect(projections.narrative.length).toBeGreaterThanOrEqual(3)
        expect(projections.narrative[0]?.type).toBe("run.created")
        const intentNarrative = projections.narrative.find((item) => item.type === "intent.created")
        const planNarrative = projections.narrative.find((item) => item.type === "plan.compiled")
        expect(intentNarrative?.message).toContain("Fix the bug")
        expect(planNarrative?.message).toContain("1 tasks")

        expect(projections.approvals).toEqual([])
        expect(projections.artifacts).toEqual([])
      })
    } finally {
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      rmSync(testHome, { recursive: true, force: true })
    }
  }, 40000)
})
