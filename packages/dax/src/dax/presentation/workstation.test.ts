import { describe, expect, test } from "bun:test"
import { deriveWorkstationState } from "./workstation"

describe("workstation presentation model", () => {
  test("derives compact operator summaries from execution state", () => {
    const state = deriveWorkstationState({
      sessionID: "test-session",
      stage: "waiting",
      stageReason: "waiting for approval",
      sessionStatusType: "busy",
      goal: "Scan dependencies and produce a report",
      todo: [
        { content: "Scan dependencies", status: "in_progress" },
        { content: "Generate report", status: "pending" },
      ],
      approvals: [{ label: "shell", reason: "external API access" }],
      questions: 0,
      artifacts: [{ label: "scan_report.json", kind: "workspace_file" }],
      diffCount: 1,
      recentTooling: [{ label: "shell · npm test", status: "pending" }],
      audit: {
        status: "warn",
        blockerCount: 0,
        warningCount: 2,
        infoCount: 0,
      },
      alert: {
        level: "warning",
        message: "1 request waiting",
      },
    })

    expect(state.sessionID).toBe("test-session")
    expect(state.lifecycle).toBe("awaiting_approval")
    expect(state.planSummary.steps[0].label).toBe("Scan dependencies")
    expect(state.planSummary.steps[0].status).toBe("active")
    expect(state.approvalSummary.pendingCount).toBe(1)
    expect(state.artifactSummary.count).toBe(1)
    expect(state.auditSummary.posture).toBe("review_needed")
    expect(state.trustLabel).toBe("Review needed")
  })

  test("uses approval reason or recent tooling instead of low-signal idle state", () => {
    const approvalState = deriveWorkstationState({
      sessionID: "approval-session",
      stage: "done",
      stageReason: "idle",
      sessionStatusType: "idle",
      goal: "Release readiness review",
      todo: [],
      approvals: [{ label: "shell", reason: "publish requires approval" }],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      recentTooling: [{ label: "shell · npm publish", status: "pending" }],
    })

    expect(approvalState.currentStep).toBe("publish requires approval")
    expect(approvalState.activitySummary.items[0]).toContain("publish requires approval")

    const toolingState = deriveWorkstationState({
      sessionID: "tool-session",
      stage: "done",
      stageReason: "idle",
      sessionStatusType: "idle",
      goal: "Inspect README",
      todo: [],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      recentTooling: [{ label: "read · README.md", status: "completed" }],
    })

    expect(toolingState.currentStep).toBe("read · README.md")
    expect(toolingState.activitySummary.items).toContain("read · README.md")
  })

  test("treats provider delay as active execution instead of a blocked state", () => {
    const delayedState = deriveWorkstationState({
      sessionID: "delayed-session",
      stage: "thinking",
      stageReason: "waiting for provider response",
      sessionStatusType: "delayed",
      goal: "Check Gemini responsiveness",
      todo: [{ content: "Check provider behavior", status: "in_progress" }],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      recentTooling: [{ label: "read · README.md", status: "completed" }],
    })

    expect(delayedState.lifecycle).toBe("executing")
    expect(delayedState.currentStep).toBe("Check provider behavior")
    expect(delayedState.activitySummary.items).toContain("Check provider behavior")
  })

  test("does not keep completed idle runs in review-needed posture without active risk", () => {
    const completedState = deriveWorkstationState({
      sessionID: "completed-session",
      stage: "done",
      stageReason: "idle",
      sessionStatusType: "idle",
      goal: "Initial check-in",
      todo: [{ content: "Scope request: Initial check-in", status: "completed" }],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      recentTooling: [],
    })

    expect(completedState.lifecycle).toBe("completed")
    expect(completedState.trustPosture).toBe("clear")
    expect(completedState.trustLabel).toBe("Clear")
  })
})
