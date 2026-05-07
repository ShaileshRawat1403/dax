import { describe, expect, test } from "bun:test"
import { deriveWorkstationState, describeLifecycle } from "./workstation"

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

  test("maps delayed session status to waiting_for_capacity", () => {
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

    expect(delayedState.lifecycle).toBe("waiting_for_capacity")
    expect(delayedState.lifecycleLabel).toBe("Waiting for model capacity")
    expect(delayedState.currentStep).toBe("Check provider behavior")
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

  test("maps retry session status to retrying, not blocked", () => {
    const retryState = deriveWorkstationState({
      sessionID: "retry-session",
      stage: "retrying",
      stageReason: "provider rate limit reached",
      sessionStatusType: "retry",
      goal: "Run tests",
      todo: [],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
    })

    expect(retryState.lifecycle).toBe("retrying")
    expect(retryState.lifecycleLabel).toBe("Retrying")
  })

  test("preserves blocked state for error-level alerts requiring intervention", () => {
    const blockedState = deriveWorkstationState({
      sessionID: "blocked-session",
      stage: "executing",
      stageReason: "permission denied",
      sessionStatusType: "busy",
      goal: "Write to protected path",
      todo: [],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      alert: { level: "error", message: "missing permission" },
    })

    expect(blockedState.lifecycle).toBe("blocked")
    expect(blockedState.lifecycleLabel).toBe("Blocked")
  })

  test("describeLifecycle returns no-action copy for capacity wait and retry", () => {
    expect(describeLifecycle({ lifecycle: "waiting_for_capacity" })).toContain("automatically")
    expect(describeLifecycle({ lifecycle: "retrying" })).toContain("automatically")
    expect(describeLifecycle({ lifecycle: "blocked" })).toContain("intervention")
    expect(describeLifecycle({ lifecycle: "awaiting_approval" })).toContain("approval")
  })

  test("surfaces plan gate and completion proof warnings in activity summary", () => {
    const state = deriveWorkstationState({
      sessionID: "trust-guard-session",
      stage: "done",
      stageReason: "idle",
      sessionStatusType: "idle",
      goal: "Prepare release checklist",
      todo: [],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 0,
      planQuality: {
        score: 60,
        decision: "pause",
        failedChecks: ["scope_declared", "validation_declared"],
      },
      completionProof: {
        ready: false,
        missing: ["verification receipts"],
      },
    })

    expect(state.activitySummary.items[0]).toContain("Plan gate 60/100")
    expect(state.activitySummary.items[1]).toContain("Completion proof missing")
  })
})
