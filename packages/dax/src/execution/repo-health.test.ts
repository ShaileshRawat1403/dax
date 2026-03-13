import { expect, test, describe } from "bun:test"
import path from "path"
import { runGraph } from "./run-graph"
import { createInitializedRouter } from "../operators/router"
import { buildWorkflowGraph } from "../workflows/builtin-workflows"
import { SessionStateManager } from "../session/update-state"
import type { SessionState } from "../session/state-types"

function createInitialSessionState(sessionId: string, cwd: string): SessionState {
  return {
    id: sessionId,
    status: "active",
    workspace: {
      cwd: cwd,
    },
    findings: [],
    hypotheses: [],
    openQuestions: [],
    risks: [],
    nextActions: [],
    completedSteps: [],
    emittedArtifacts: [],
    trustState: {
      score: 0.5,
      posture: "neutral",
      signals: [],
      lastUpdated: new Date().toISOString(),
    },
    approvalState: {
      pending: [],
      granted: [],
      denied: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe("repo-health workflow", () => {
  const router = createInitializedRouter()

  test("should run repo-health workflow on healthy fixture", async () => {
    const fixturePath = path.resolve("../../test/fixtures/healthy-repo")
    const sessionId = "test-healthy"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath))
    stateManager.updateWorkflow("repo-health")

    const result = await runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager)

    const state = stateManager.getState()

    // Assert workflow completed
    expect(result.success).toBe(true)

    // Assert artifacts were emitted
    expect(state.emittedArtifacts.length).toBeGreaterThan(0)

    // Check for specific artifact types
    const artifactTypes = state.emittedArtifacts.map((a) => a.type)
    expect(artifactTypes).toContain("explore_report")
    expect(artifactTypes).toContain("verification_report")
    expect(artifactTypes).toContain("artifact_inventory")
    expect(artifactTypes).toContain("release_report")

    console.log("Healthy repo result:", {
      success: result.success,
      artifacts: state.emittedArtifacts.map((a) => a.type),
      trustScore: state.trustState.score,
    })
  })

  test("should run repo-health workflow on messy fixture", async () => {
    const fixturePath = path.resolve("../../test/fixtures/messy-repo")
    const sessionId = "test-messy"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath))
    stateManager.updateWorkflow("repo-health")

    const result = await runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager)

    const state = stateManager.getState()

    // Assert workflow completed
    expect(result.success).toBe(true)

    // Check that artifacts were emitted
    expect(state.emittedArtifacts.length).toBeGreaterThan(0)

    console.log("Messy repo result:", {
      success: result.success,
      artifacts: state.emittedArtifacts.map((a) => a.type),
      trustScore: state.trustState.score,
      findings: state.findings.length,
      risks: state.risks.length,
    })
  })

  test("should handle low trust scenario", async () => {
    const fixturePath = path.resolve("../../test/fixtures/blocked-repo")
    const sessionId = "test-blocked"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath))
    stateManager.updateWorkflow("repo-health")

    // Simulate a low trust score to trigger blocking
    stateManager.addTrustSignal({
      source: "test",
      delta: -0.6,
      reason: "Simulated low trust",
    })

    const result = await runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager)

    const state = stateManager.getState()

    // Workflow should complete but trust should be degraded
    expect(result.success).toBe(true)

    console.log("Blocked repo result:", {
      success: result.success,
      artifacts: state.emittedArtifacts.map((a) => a.type),
      trustScore: state.trustState.score,
      trustPosture: state.trustState.posture,
    })
  })
})
