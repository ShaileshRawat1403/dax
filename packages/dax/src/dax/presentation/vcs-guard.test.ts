import { describe, expect, test } from "bun:test"
import { deriveFeatureBranchNudge, isDefaultBranch } from "./vcs-guard"

describe("vcs-guard", () => {
  test("identifies default branches", () => {
    expect(isDefaultBranch("main")).toBe(true)
    expect(isDefaultBranch("master")).toBe(true)
    expect(isDefaultBranch("feature/x")).toBe(false)
    expect(isDefaultBranch(undefined)).toBe(false)
  })

  test("does not nudge on feature branches", () => {
    expect(
      deriveFeatureBranchNudge({
        branch: "feat/hardening",
        workflowMode: "build",
      }),
    ).toBeUndefined()
  })

  test("warns before mutating on main", () => {
    const nudge = deriveFeatureBranchNudge({
      branch: "main",
      workflowMode: "build",
    })

    expect(nudge?.tone).toBe("warning")
    expect(nudge?.title).toContain("feature branch")
  })

  test("escalates when concrete changes already exist on main", () => {
    const nudge = deriveFeatureBranchNudge({
      branch: "main",
      workflowMode: "build",
      hasConcreteChanges: true,
    })

    expect(nudge?.tone).toBe("warning")
    expect(nudge?.detail).toContain("GitHub CI")
  })

  test("does not nudge for read-only planning on main", () => {
    expect(
      deriveFeatureBranchNudge({
        branch: "main",
        workflowMode: "plan",
      }),
    ).toBeUndefined()
  })

  test("nudges planning only when changes already exist on main", () => {
    const nudge = deriveFeatureBranchNudge({
      branch: "main",
      workflowMode: "plan",
      hasConcreteChanges: true,
    })

    expect(nudge?.tone).toBe("muted")
    expect(nudge?.detail).toContain("trustworthy")
  })
})
