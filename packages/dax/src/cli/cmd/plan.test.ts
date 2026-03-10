import { describe, expect, test } from "bun:test"
import { createPlanPreview, extractPlanSteps, extractPlanSummary, formatPlanPreview } from "./plan"

describe("plan command helpers", () => {
  test("extracts summary and steps from markdown plan content", () => {
    const content = `# Governance review

Review the approval surfaces before execution.

1. Inspect pending approvals
2. Review policy and audit coverage
- Summarize operator-facing gaps
`

    expect(extractPlanSummary(content)).toBe("Governance review")
    expect(extractPlanSteps(content)).toEqual([
      "Inspect pending approvals",
      "Review policy and audit coverage",
      "Summarize operator-facing gaps",
    ])
  })

  test("marks structured plans as ready", () => {
    const preview = createPlanPreview({
      sessionID: "session_plan",
      intent: "Review governance gaps",
      content: `# Governance review

1. Inspect pending approvals
2. Summarize gaps`,
      planPath: ".dax/plans/governance-review.md",
      contentSource: "plan_file",
      suppressedInteractiveGate: true,
    })

    expect(preview.readiness).toBe("ready")
    expect(preview.content_source).toBe("plan_file")
    expect(preview.note).toContain("interactive checkpoint")
  })

  test("marks text without steps as incomplete", () => {
    const preview = createPlanPreview({
      sessionID: "session_plan",
      intent: "Review governance gaps",
      content: "Need more information about the deployment environment before planning.",
      contentSource: "assistant_output",
    })

    expect(preview.readiness).toBe("incomplete")
    expect(preview.steps).toEqual([])
  })

  test("marks missing content as blocked", () => {
    const preview = createPlanPreview({
      sessionID: "session_plan",
      intent: "Review governance gaps",
    })

    expect(preview.readiness).toBe("blocked")
    expect(preview.summary).toBe("No plan was produced.")
  })

  test("formats a readable plan preview for operators", () => {
    const rendered = formatPlanPreview(
      createPlanPreview({
        sessionID: "session_plan",
        intent: "Review governance gaps",
        content: `# Governance review

1. Inspect pending approvals`,
        planPath: ".dax/plans/governance-review.md",
        contentSource: "plan_file",
      }),
    )

    expect(rendered).toContain("Intent: Review governance gaps")
    expect(rendered).toContain("Readiness: ready")
    expect(rendered).toContain("Plan file: .dax/plans/governance-review.md")
    expect(rendered).toContain("1. Inspect pending approvals")
  })
})
