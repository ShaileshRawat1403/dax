import { expect, test, describe } from "bun:test"
import path from "path"
import { buildWorkflowGraph } from "../workflows/builtin-workflows"
import { runGraph } from "./run-graph"
import { OperatorRouter } from "../operators/router"
import { SessionStateManager } from "../session/update-state"
import { ExploreOperator } from "../operators/explore"
import { VerifyOperator } from "../operators/verify"
import { ArtifactOperator } from "../operators/artifact"
import { ReleaseOperator } from "../operators/release"
import { Instance } from "../project/instance"
import type { SessionState } from "../session/state-types"

// Mock router with necessary operators
function createInitializedRouter(): OperatorRouter {
  const router = new OperatorRouter()
  router.register(new ExploreOperator())
  router.register(new VerifyOperator())
  router.register(new ArtifactOperator())
  router.register(new ReleaseOperator())
  return router
}

function createInitialSessionState(sessionId: string, repoPath: string): SessionState {
  const now = new Date().toISOString()
  return {
    id: sessionId,
    status: "active",
    workspace: {
      cwd: repoPath,
    },
    workflowId: "repo-health",
    findings: [],
    hypotheses: [],
    openQuestions: [],
    risks: [],
    nextActions: [],
    completedSteps: [],
    emittedArtifacts: [],
    trustState: {
      score: 0.8,
      posture: "trusted",
      signals: [],
      lastUpdated: now,
    },
    approvalState: {
      pending: [],
      granted: [],
      denied: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}

describe("repo-health workflow", () => {
  const router = createInitializedRouter()

  test("should run repo-health workflow on healthy fixture", async () => {
    const fixturePath = path.resolve(import.meta.dir, "../../../../test/fixtures/healthy-repo")
    const sessionId = "test-healthy"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath), sessionId)
    stateManager.updateWorkflow("repo-health")

    const result = await Instance.provide({
      directory: fixturePath,
      fn: () => runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager),
    })

    const state = stateManager.getState()

    // Assert workflow completed
    expect(result.success).toBe(true)

    // Assert artifacts were emitted
    expect(state.emittedArtifacts.length).toBeGreaterThan(0)
  })

  test("should run repo-health workflow on messy fixture", async () => {
    const fixturePath = path.resolve(import.meta.dir, "../../../../test/fixtures/messy-repo")
    const sessionId = "test-messy"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath), sessionId)
    stateManager.updateWorkflow("repo-health")

    const result = await Instance.provide({
      directory: fixturePath,
      fn: () => runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager),
    })

    const state = stateManager.getState()

    // Assert workflow completed (it should still complete even if messy)
    expect(result.success).toBe(true)

    // Assert artifacts were emitted
    expect(state.emittedArtifacts.length).toBeGreaterThan(0)
  })

  test("should handle low trust scenario", async () => {
    const fixturePath = path.resolve(import.meta.dir, "../../../../test/fixtures/blocked-repo")
    const sessionId = "test-blocked"

    const graph = buildWorkflowGraph("repo-health")
    const initialState = createInitialSessionState(sessionId, fixturePath)
    // Manually set low trust
    initialState.trustState = {
      score: 0.2,
      posture: "untrusted",
      signals: [],
      lastUpdated: new Date().toISOString(),
    }

    const stateManager = new SessionStateManager(initialState, sessionId)
    stateManager.updateWorkflow("repo-health")

    const result = await Instance.provide({
      directory: fixturePath,
      fn: () => runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager),
    })

    // It should still run the graph, trust posture is handled by operators if needed
    expect(result.success).toBe(true)
  })
})
