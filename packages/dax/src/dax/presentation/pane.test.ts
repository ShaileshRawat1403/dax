import { describe, expect, it } from "bun:test"
import {
  deriveActivePaneMode,
  PANE_MODE,
  deriveAutoPaneMode,
  paneCompactLabel,
  paneLabel,
  shouldAutoShowPane,
} from "./pane"

describe("pane presentation model", () => {
  it("keeps refine, approvals, audit, and memory as first-class pane modes", () => {
    expect(PANE_MODE).toContain("audit")
    expect(PANE_MODE).toContain("approvals")
    expect(PANE_MODE).toContain("memory")
    expect(PANE_MODE).toContain("refine")
    expect(PANE_MODE).not.toContain("plan")
  })

  it("uses concrete operator labels for the remaining pane surfaces", () => {
    expect(paneLabel("audit", false)).toBe("audit")
    expect(paneLabel("refine", false)).toBe("refine")
    expect(paneLabel("memory", false)).toBe("memory")
    expect(paneCompactLabel("approvals", false)).toBe("approve")
  })

  it("prioritizes approvals, then audit, then memory, with refine drafts available but not auto-dominant", () => {
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
        fallback: "refine",
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
        fallback: "refine",
      }),
    ).toBe("audit")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "done",
        fallback: "audit",
      }),
    ).toBe("memory")

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
        fallback: "audit",
      }),
    ).toBe("memory")

    expect(
      deriveAutoPaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: false,
        hasPlanContext: false,
        liveStage: "planning",
        fallback: "audit",
      }),
    ).toBe("refine")
  })

  it("shows the auto pane only on wide layouts when a core surface matters", () => {
    expect(
      shouldAutoShowPane({
        wide: true,
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: false,
        hasMemoryContext: false,
        hasPlanContext: false,
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

  it("does not let a refine draft override the live pane while follow mode is active", () => {
    expect(
      deriveActivePaneMode({
        hasApprovals: false,
        hasRefineDraft: true,
        hasAuditAttention: false,
        hasDiffContext: false,
        hasLiveContext: true,
        hasMemoryContext: true,
        hasPlanContext: true,
        liveStage: "executing",
        fallback: "audit",
        paneMode: "memory",
        paneVisibility: "pinned",
        paneFollowMode: "live",
        following: false,
      }),
    ).toBe("memory")
  })

  it("keeps approvals ahead of refine when operator input is pending", () => {
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
        fallback: "audit",
        paneMode: "refine",
        paneVisibility: "pinned",
        paneFollowMode: "live",
        following: false,
      }),
    ).toBe("approvals")
  })
})
