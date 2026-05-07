import { describe, expect, test } from "bun:test"
import { deriveVerificationPosture, formatSdlcVerification } from "./verify-session"
import type { CheckResult, VerificationReport } from "./check-types"

function result(status: CheckResult["status"], required: boolean): CheckResult {
  return {
    id: `${status}-${required ? "required" : "optional"}`,
    kind: "test",
    label: "Example check",
    command: "example",
    cwd: "/repo",
    required,
    risk: "medium",
    exitCode: status === "passed" ? 0 : 1,
    status,
    startedAt: "2026-05-07T00:00:00Z",
    finishedAt: "2026-05-07T00:00:01Z",
    durationMs: 1000,
    stdoutPreview: "",
    stderrPreview: "",
  }
}

describe("SDLC verification report", () => {
  test("derives posture from required and optional checks", () => {
    expect(deriveVerificationPosture([])).toBe("guarded")
    expect(deriveVerificationPosture([result("passed", true), result("skipped", false)])).toBe("verified")
    expect(deriveVerificationPosture([result("failed", true)])).toBe("blocked")
    expect(deriveVerificationPosture([result("error", true)])).toBe("failed")
    expect(deriveVerificationPosture([result("passed", true), result("failed", false)])).toBe("guarded")
  })

  test("formats empty check sets clearly", () => {
    const report: VerificationReport = {
      schemaVersion: "dax.sdlc.verification.v1",
      source: "dax",
      runId: "run_1",
      repoRoot: "/repo",
      checks: [],
      posture: "guarded",
      blockingReasons: [],
      generatedAt: "2026-05-07T00:00:00Z",
    }

    expect(formatSdlcVerification(report)).toContain("No checks detected")
  })
})
