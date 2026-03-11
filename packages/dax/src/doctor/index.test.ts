import { describe, expect, test } from "bun:test"
import { aggregateProductState, labelProductState, nextActionForErrorMessage, nextActionForMcpStatus } from "@/dax/status"
import { doctorExitCode, formatDoctorReport, type DoctorReport } from "./index"

describe("doctor helpers", () => {
  test("aggregates readiness by severity", () => {
    expect(aggregateProductState(["connected", "waiting"])).toBe("waiting")
    expect(aggregateProductState(["connected", "blocked"])).toBe("blocked")
    expect(aggregateProductState(["blocked", "failed"])).toBe("failed")
  })

  test("maps product state labels and exit codes", () => {
    expect(labelProductState("needs_approval")).toBe("needs approval")
    expect(doctorExitCode("connected")).toBe(0)
    expect(doctorExitCode("blocked")).toBe(1)
  })

  test("formats an aggregate report for human output", () => {
    const report: DoctorReport = {
      generatedAt: "2026-03-08T00:00:00.000Z",
      state: "blocked",
      sections: [
        {
          id: "auth",
          title: "Authentication",
          state: "blocked",
          summary: "provider auth needs attention",
          detail: ["google: blocked"],
          next: ["Run `dax auth login`."],
        },
      ],
    }

    expect(formatDoctorReport(report)).toContain("DAX doctor: blocked")
    expect(formatDoctorReport(report)).toContain("Authentication: blocked")
  })

  test("recovery helpers return a concrete next action", () => {
    expect(nextActionForMcpStatus("workspace_kernel", { status: "needs_auth" })).toContain("dax mcp auth workspace_kernel")
    expect(nextActionForErrorMessage("rejected permission for bash")).toContain("Inspect approvals")
    expect(nextActionForErrorMessage("OAuth token missing")).toContain("dax doctor auth")
  })
})
