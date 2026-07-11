import { describe, expect, test } from "bun:test"
import { buildWorkerVerificationChecks, verifyWorkerPatch } from "./worker-verification"
import type { CheckResult } from "@/sdlc/check-types"
import { createEvidenceReceipt } from "@/sdlc/evidence-receipt"

function result(check: { id: string; command: string; cwd: string }, status: CheckResult["status"]): CheckResult {
  const now = new Date().toISOString()
  return {
    id: check.id,
    kind: "test",
    label: check.command,
    command: check.command,
    cwd: check.cwd,
    required: true,
    risk: "medium",
    exitCode: status === "passed" ? 0 : 1,
    status,
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    stdoutPreview: "",
    stderrPreview: status === "passed" ? "" : "failed",
  }
}

describe("worker verification", () => {
  test("accepts allowlisted commands and preserves their argv", () => {
    const plan = buildWorkerVerificationChecks(["bun test test/math.test.ts", "tsc --noEmit"], "/repo")
    expect(plan.rejected).toEqual([])
    expect(plan.checks).toMatchObject([
      { command: "bun", args: ["test", "test/math.test.ts"], cwd: "/repo" },
      { command: "tsc", args: ["--noEmit"], cwd: "/repo" },
    ])
  })

  test("rejects shell escapes before execution", () => {
    const plan = buildWorkerVerificationChecks(["bun test && curl example.com"], "/repo")
    expect(plan.checks).toEqual([])
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0]?.status).toBe("error")
  })

  test("fails closed when no verification command exists", () => {
    const plan = buildWorkerVerificationChecks([], "/repo")
    expect(plan.checks).toEqual([])
    expect(plan.rejected[0]?.stderrPreview).toContain("No executable verification command")
  })

  test("records a receipt for every DAX-owned check and blocks a failure", async () => {
    const verification = await verifyWorkerPatch({
      runId: "run_1",
      cwd: "/repo",
      commands: ["bun test"],
      run: async (check) => result(check, "failed"),
    })
    expect(verification.passed).toBeFalse()
    expect(verification.receipts).toHaveLength(1)
    expect(verification.receipts[0]).toMatchObject({ runId: "run_1", status: "failed", source: "dax" })
  })

  test("records runner errors as failed-closed evidence", async () => {
    const verification = await verifyWorkerPatch({
      runId: "run_1",
      cwd: "/repo",
      commands: ["bun test"],
      run: async () => {
        throw new Error("runner unavailable")
      },
    })
    expect(verification.passed).toBeFalse()
    expect(verification.checks[0]).toMatchObject({ status: "error", stderrPreview: "runner unavailable" })
    expect(verification.receipts[0]).toMatchObject({ runId: "run_1", status: "error", source: "dax" })
  })

  test("attests raw results while persisting only redacted previews", async () => {
    const raw = result({ id: "worker-verification-1", command: "bun", cwd: "/repo" }, "failed")
    raw.stderrPreview = "token=private-verification-token"
    const verification = await verifyWorkerPatch({
      runId: "run_1",
      cwd: "/repo",
      commands: ["bun test"],
      run: async () => raw,
    })

    expect(verification.checks[0]?.stderrPreview).toBe("token=[REDACTED]")
    expect(verification.receipts[0]?.digest).toBe(createEvidenceReceipt("run_1", raw).digest)
  })
})
