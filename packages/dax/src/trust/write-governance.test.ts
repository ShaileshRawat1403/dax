import { describe, expect, test } from "bun:test"
import {
  classifyWritePathRisk,
  deriveWriteOutcome,
  deriveWriteGovernanceStatus,
  governanceExpectationForBucket,
} from "./write-governance"

describe("write governance derivation", () => {
  test("returns none when no workspace write artifacts exist", () => {
    expect(
      deriveWriteGovernanceStatus({
        write_intent_detected: false,
        workspace_write_artifact_count: 0,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("none")
  })

  test("returns blocked when write activity still has pending approvals", () => {
    expect(
      deriveWriteGovernanceStatus({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 1,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: false,
        lifecycle_requires_reconciliation: true,
      }),
    ).toBe("blocked")
  })

  test("returns governed when policy evidence is present", () => {
    expect(
      deriveWriteGovernanceStatus({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: true,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("governed")
  })

  test("returns governed when override evidence exists", () => {
    expect(
      deriveWriteGovernanceStatus({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 1,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("governed")
  })

  test("returns ungated when write artifacts exist without governance evidence", () => {
    expect(
      deriveWriteGovernanceStatus({
        write_intent_detected: true,
        workspace_write_artifact_count: 2,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("ungated")
  })
})

describe("write outcome derivation", () => {
  test("returns none when no write intent and no durable result exist", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: false,
        workspace_write_artifact_count: 0,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("none")
  })

  test("returns no_durable_result when write intent exists without retained output", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: true,
        workspace_write_artifact_count: 0,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("no_durable_result")
  })

  test("returns blocked when governance remained unresolved", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 1,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: false,
        lifecycle_requires_reconciliation: true,
      }),
    ).toBe("blocked")
  })

  test("returns partial when durable writes exist but lifecycle did not finish cleanly", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: false,
        lifecycle_requires_reconciliation: true,
      }),
    ).toBe("partial")
  })

  test("returns governed_completed when durable writes finished with governance evidence", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: true,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("governed_completed")
  })

  test("returns completed_ungated when durable writes finished without governance evidence", () => {
    expect(
      deriveWriteOutcome({
        write_intent_detected: true,
        workspace_write_artifact_count: 1,
        pending_approval_count: 0,
        override_count: 0,
        policy_evaluated: false,
        lifecycle_terminal: true,
        lifecycle_requires_reconciliation: false,
      }),
    ).toBe("completed_ungated")
  })
})

describe("write risk classification", () => {
  test("classifies temporary local writes as harmless_local", () => {
    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "tmp/cache.txt",
      }),
    ).toEqual({
      path: "tmp/cache.txt",
      bucket: "harmless_local",
      governance_expectation: "optional",
    })
  })

  test("classifies generated artifact outputs as project_artifact", () => {
    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "artifacts/eval-burst/result.json",
      }),
    ).toEqual({
      path: "artifacts/eval-burst/result.json",
      bucket: "project_artifact",
      governance_expectation: "expected",
    })
  })

  test("classifies source and docs edits as governed_project_write", () => {
    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "src/index.ts",
      }).bucket,
    ).toBe("governed_project_write")

    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "docs/guide.md",
      }).bucket,
    ).toBe("governed_project_write")
  })

  test("classifies sensitive and escaping paths as sensitive_or_system_write", () => {
    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "package.json",
      }).bucket,
    ).toBe("sensitive_or_system_write")

    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: ".env",
      }).bucket,
    ).toBe("sensitive_or_system_write")

    expect(
      classifyWritePathRisk({
        sessionDirectory: "/repo",
        reference: "../outside.txt",
      }).bucket,
    ).toBe("sensitive_or_system_write")
  })
})

describe("governance expectation", () => {
  test("maps risk buckets to stable expectations", () => {
    expect(governanceExpectationForBucket("harmless_local")).toBe("optional")
    expect(governanceExpectationForBucket("project_artifact")).toBe("expected")
    expect(governanceExpectationForBucket("governed_project_write")).toBe("expected")
    expect(governanceExpectationForBucket("sensitive_or_system_write")).toBe("required")
  })
})
