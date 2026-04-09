import { describe, expect, it } from "bun:test"
import { deriveActivePaneMode, PANE_MODE, deriveAutoPaneMode, paneCompactLabel, paneLabel, shouldAutoShowPane } from "./pane"

describe("pane presentation model", () => {
  it("includes audit and memory as first-class pane modes", () => {
    expect(PANE_MODE).toContain("audit")
    expect(PANE_MODE).toContain("memory")
    expect(PANE_MODE).not.toContain("diff")
  })

  it("uses concrete operator labels for the pane surfaces", () => {
    expect(paneLabel("audit", false)).toBe("audit")
    expect(paneLabel("plan", false)).toBe("workstation")
    expect(paneLabel("memory", false)).toBe("memory")
    expect(paneCompactLabel("approvals", false)).toBe("approve")
    expect(paneCompactLabel("plan", false)).toBe("work")
  })

  it("prioritizes approvals, then audit attention, then live workstation context, then refine, then memory", () => {
    expect(
      deriveAutoPaneMode({
        hasApprovals: true,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasDiffContext: true,
        hasLiveContext: true,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "planning",
        fallback: "plan",
      }),
    ).toBe("approvals")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasAuditAttention: true,
        hasRefineDraft: true,
        hasDiffContext: true,
        hasLiveContext: false,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "done",
        fallback: "plan",
      }),
    ).toBe("audit")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasDiffContext: true,
        hasLiveContext: true,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "executing",
        fallback: "plan",
      }),
    ).toBe("plan")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "done",
        fallback: "plan",
      }),
    ).toBe("refine")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "done",
        fallback: "plan",
      }),
    ).toBe("memory")
  })

  it("shows the auto pane only on wide layouts when a core dax surface matters", () => {
    expect(
      shouldAutoShowPane({
        wide: true,
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: false,
        hasPlanContext: true,
      }),
    ).toBe(true)

    expect(
      shouldAutoShowPane({
        wide: false,
        hasApprovals: true,
        hasRefineDraft: true,
        hasAuditAttention: true,
        hasDiffContext: true,
        hasLiveContext: true,
        hasMemoryContext: true,
        hasPlanContext: true,
      }),
    ).toBe(false)
  })

  it("keeps a manually pinned pane active even when follow mode is live", () => {
    expect(
      deriveActivePaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: true,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "executing",
        fallback: "plan",
        paneMode: "refine",
        paneVisibility: "pinned",
        paneFollowMode: "live",
        smartFollowActive: false,
      }),
    ).toBe("refine")
  })

  it("still lets approvals override a manually pinned pane", () => {
    expect(
      deriveActivePaneMode({
        hasApprovals: true,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: true,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "executing",
        fallback: "plan",
        paneMode: "refine",
        paneVisibility: "pinned",
        paneFollowMode: "live",
        smartFollowActive: false,
      }),
    ).toBe("approvals")
  })

  it("keeps the rail on workstation once live execution settles and concrete changes are available", () => {
    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: false,
        hasDiffContext: true,
        hasLiveContext: false,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "done",
        fallback: "plan",
      }),
    ).toBe("plan")
  })

  it("switches the rail to audit during verification when trust needs attention, otherwise stays on workstation", () => {
    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: true,
        hasDiffContext: true,
        hasLiveContext: true,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "verifying",
        fallback: "plan",
      }),
    ).toBe("audit")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: false,
        hasAuditAttention: false,
        hasDiffContext: true,
        hasLiveContext: true,
        hasMemoryContext: false,
        hasPlanContext: true,
        liveStage: "verifying",
        fallback: "plan",
      }),
    ).toBe("plan")
  })
})
