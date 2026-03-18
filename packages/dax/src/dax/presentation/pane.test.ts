import { describe, expect, it } from "bun:test"
import { PANE_MODE, deriveAutoPaneMode, paneCompactLabel, paneLabel, shouldAutoShowPane } from "./pane"

describe("pane presentation model", () => {
  it("includes audit as a first-class pane mode", () => {
    expect(PANE_MODE).toContain("audit")
  })

  it("uses a concrete label for diffs and exposes audit directly", () => {
    expect(paneLabel("diff", false)).toBe("changes")
    expect(paneLabel("audit", false)).toBe("audit")
    expect(paneCompactLabel("approvals", false)).toBe("approve")
  })

  it("prioritizes approvals, then refine, then audit, then plan for auto pane focus", () => {
    expect(
      deriveAutoPaneMode({
        hasApprovals: true,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasPlanContext: true,
        fallback: "diff",
      }),
    ).toBe("approvals")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasPlanContext: true,
        fallback: "diff",
      }),
    ).toBe("refine")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: true,
        hasPlanContext: true,
        fallback: "diff",
      }),
    ).toBe("audit")
  })

  it("shows the auto pane only on wide layouts when a core dax surface matters", () => {
    expect(
      shouldAutoShowPane({
        wide: true,
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: false,
        hasPlanContext: true,
      }),
    ).toBe(true)

    expect(
      shouldAutoShowPane({
        wide: false,
        hasApprovals: true,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasPlanContext: true,
      }),
    ).toBe(false)
  })
})
