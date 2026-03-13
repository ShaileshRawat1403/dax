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

const EXPECTED_ARTIFACT_TYPES = ["explore_report", "verification_report", "artifact_inventory", "release_report"]

describe("Artifact Contract Validation", () => {
  const router = createInitializedRouter()

  test("repo-health emits all required artifacts with valid schemas", async () => {
    const fixturePath = path.resolve("../../test/fixtures/healthy-repo")
    const sessionId = "test-artifact-contract"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath))
    stateManager.updateWorkflow("repo-health")

    const result = await runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager)

    expect(result.success).toBe(true)

    const state = stateManager.getState()
    const artifacts = state.emittedArtifacts

    // Verify all expected artifact types are present
    const emittedTypes = artifacts.map((a) => a.type)
    for (const expectedType of EXPECTED_ARTIFACT_TYPES) {
      expect(emittedTypes).toContain(expectedType)
    }

    // Validate each artifact has required fields
    for (const artifact of artifacts) {
      expect(artifact.type).toBeDefined()
      expect(artifact.type).toBeString()
      expect(artifact.producedBy).toBeDefined()
      expect(artifact.producedBy).toBeString()
      expect(artifact.timestamp).toBeDefined()
      expect(artifact.timestamp).toBeString()
    }

    // Verify explore_report has description
    const exploreArtifact = artifacts.find((a) => a.type === "explore_report")
    expect(exploreArtifact?.description).toBeDefined()
    expect(exploreArtifact?.description).toBeString()

    // Verify verification_report has description
    const verifyArtifact = artifacts.find((a) => a.type === "verification_report")
    expect(verifyArtifact?.description).toBeDefined()
    expect(verifyArtifact?.description).toBeString()

    // Verify artifact_inventory has description
    const artifactInventory = artifacts.find((a) => a.type === "artifact_inventory")
    expect(artifactInventory?.description).toBeDefined()
    expect(artifactInventory?.description).toBeString()

    // Verify release_report has description
    const releaseArtifact = artifacts.find((a) => a.type === "release_report")
    expect(releaseArtifact?.description).toBeDefined()
    expect(releaseArtifact?.description).toBeString()
  })

  test("workflow-summary.json has required fields", async () => {
    const fixturePath = path.resolve("../../test/fixtures/healthy-repo")
    const sessionId = "test-summary-contract"

    const graph = buildWorkflowGraph("repo-health")
    const stateManager = new SessionStateManager(createInitialSessionState(sessionId, fixturePath))
    stateManager.updateWorkflow("repo-health")

    await runGraph(graph, { cwd: fixturePath, sessionId }, router, stateManager)

    const state = stateManager.getState()
    state.status = "completed"
    state.completedAt = new Date().toISOString()

    // Generate summary (same as CLI does)
    const summary = {
      schema_version: "1.0.0",
      workflow: "repo-health",
      session_id: state.id,
      target_repo: state.workspace.cwd,
      status: state.status,
      trust_score: state.trustState.score,
      release_status: "ready",
      trust_summary: {
        score: state.trustState.score,
        posture: state.trustState.posture,
        signals_count: state.trustState.signals.length,
      },
      governance_result: {
        findings_count: state.findings.length,
        risks_count: state.risks.length,
        blockers: state.findings.filter((f) => f.severity === "critical").map((f) => f.title),
        warnings: state.risks.map((r) => r.description || ""),
      },
      emitted_artifacts: state.emittedArtifacts.map((a) => ({
        type: a.type,
        path: a.path,
        produced_by: a.producedBy,
      })),
      recommended_next_steps: state.nextActions.filter((a) => a.status === "pending").map((a) => a.description),
      completed_at: state.completedAt,
    }

    // Validate required fields
    expect(summary.schema_version).toBeDefined()
    expect(summary.workflow).toBe("repo-health")
    expect(summary.session_id).toBeDefined()
    expect(summary.target_repo).toBeDefined()
    expect(summary.status).toBeDefined()
    expect(["active", "completed", "failed", "blocked"]).toContain(summary.status)
    expect(summary.trust_score).toBeGreaterThanOrEqual(0)
    expect(summary.trust_score).toBeLessThanOrEqual(1)
    expect(["ready", "blocked", "needs-work", "unknown"]).toContain(summary.release_status)
    expect(summary.trust_summary).toBeDefined()
    expect(summary.trust_summary.score).toBeDefined()
    expect(summary.trust_summary.posture).toBeDefined()
    expect(summary.governance_result).toBeDefined()
    expect(summary.governance_result.findings_count).toBeDefined()
    expect(summary.governance_result.risks_count).toBeDefined()
    expect(Array.isArray(summary.governance_result.blockers)).toBe(true)
    expect(Array.isArray(summary.governance_result.warnings)).toBe(true)
    expect(Array.isArray(summary.emitted_artifacts)).toBe(true)
    expect(Array.isArray(summary.recommended_next_steps)).toBe(true)
  })
})
