import { describe, expect, test } from "bun:test"
import { deriveWorkstationState } from "./workstation"

describe("workstation presentation model", () => {
  test("derives compact operator summaries from execution state", () => {
    const state = deriveWorkstationState({
      stage: "waiting",
      stageReason: "waiting for approval",
      sessionStatusType: "busy",
      goal: "Scan dependencies and produce a report",
      todo: [
        { content: "Scan dependencies", status: "in_progress" },
        { content: "Generate report", status: "pending" },
      ],
      approvals: [{ label: "bash", reason: "external API access" }],
      questions: 0,
      artifacts: [{ label: "scan_report.json", kind: "active" }],
      diffCount: 1,
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

    expect(state.lifecycle).toBe("awaiting_approval")
    expect(state.planSummary.steps[0]).toEqual({
      label: "Scan dependencies",
      status: "active",
    })
    expect(state.approvalSummary.pendingCount).toBe(1)
    expect(state.artifactSummary.count).toBe(1)
    expect(state.auditSummary.posture).toBe("review_needed")
    expect(state.trustLabel).toBe("Review needed")
  })
})
