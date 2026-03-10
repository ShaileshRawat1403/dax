import { describe, expect, test } from "bun:test"
import { deriveWriteGovernanceStatus } from "./write-governance"

describe("write governance derivation", () => {
  test("returns none when no workspace write artifacts exist", () => {
    expect(
      deriveWriteGovernanceStatus({
        workspace_write_artifact_count: 0,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
      }),
    ).toBe("none")
  })

  test("returns blocked when write activity still has pending approvals", () => {
    expect(
      deriveWriteGovernanceStatus({
        workspace_write_artifact_count: 1,
        pending_approval_count: 1,
        override_count: 0,
        policy_evaluated: false,
      }),
    ).toBe("blocked")
  })

  test("returns governed when policy evidence is present", () => {
    expect(
      deriveWriteGovernanceStatus({
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: true,
      }),
    ).toBe("governed")
  })

  test("returns governed when override evidence exists", () => {
    expect(
      deriveWriteGovernanceStatus({
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 1,
        policy_evaluated: false,
      }),
    ).toBe("governed")
  })

  test("returns ungated when write artifacts exist without governance evidence", () => {
    expect(
      deriveWriteGovernanceStatus({
        workspace_write_artifact_count: 2,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
      }),
    ).toBe("ungated")
  })
})
