import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import {
  authSectionFromReports,
  classifyMcpReadiness,
  doctorExitCode,
  formatDoctorSection,
  workerSectionFromCheck,
} from "./index"
import type { AuthDiagnostics } from "@/provider/auth-preflight"

function authReport(providerID: string, ok: boolean): AuthDiagnostics {
  return {
    providerID,
    mode: ok ? "openai-oauth" : "missing",
    ok,
    requiredEnv: [],
    missingEnv: ok ? [] : ["PROVIDER_TOKEN"],
    details: [],
  }
}

describe("doctor readiness", () => {
  test("treats missing local MCP executables as degraded instead of blocked", () => {
    const config = {
      type: "local",
      command: ["/tmp/missing/bin/workspace-mcp", "--serve"],
    } satisfies Config.Mcp

    const result = classifyMcpReadiness(
      "workspace_kernel",
      {
        status: "failed",
        error: "ENOENT: no such file or directory, posix_spawn '/tmp/missing/bin/workspace-mcp'",
      },
      config,
    )

    expect(result.readiness).toBe("degraded")
    expect(result.detail.join("\n")).toContain("local executable missing")
    expect(result.next[0]).toContain("disable it in config")
  })

  test("treats MCP auth requirements as degraded", () => {
    const config = {
      type: "remote",
      url: "https://example.com/mcp",
    } satisfies Config.Mcp

    const result = classifyMcpReadiness("github", { status: "needs_auth" }, config)

    expect(result.readiness).toBe("degraded")
    expect(result.next[0]).toContain("dax mcp auth github")
  })

  test("doctor exit code blocks only on readiness blockers", () => {
    expect(doctorExitCode("ready")).toBe(0)
    expect(doctorExitCode("degraded")).toBe(0)
    expect(doctorExitCode("blocked")).toBe(1)
  })

  test("formatted section surfaces degraded readiness clearly", () => {
    const output = formatDoctorSection({
      id: "mcp",
      title: "MCP",
      state: "waiting",
      readiness: "degraded",
      summary: "1/1 MCP server needs attention",
      detail: ["workspace_kernel: local executable missing (/tmp/workspace-mcp)"],
      next: ["Update the MCP command."],
    })

    expect(output).toContain("MCP: Degraded")
    expect(output).toContain("operational state: Waiting")
  })

  test("keeps DAX usable when one configured provider lane is ready", () => {
    const result = authSectionFromReports([authReport("openai", true), authReport("google-vertex", false)])

    expect(result.readiness).toBe("degraded")
    expect(result.state).toBe("waiting")
    expect(result.summary).toContain("1/2 provider lanes ready")
  })

  test("blocks when no configured provider lane is usable", () => {
    const unconfigured = authSectionFromReports([])
    expect(unconfigured.readiness).toBe("blocked")
    expect(unconfigured.next[0]).toContain("dax auth login")
    expect(authSectionFromReports([authReport("openai", false)]).readiness).toBe("blocked")
  })

  test("strict provider checks block on the requested lane", () => {
    const result = authSectionFromReports([authReport("openai", true), authReport("google-vertex", false)], true)
    expect(result.readiness).toBe("blocked")
  })

  test("reports unavailable optional worker isolation without blocking DAX", () => {
    const result = workerSectionFromCheck({
      available: false,
      reason: "bubblewrap is unavailable",
      remedy: "Install bubblewrap (`bwrap`) and rerun `dax doctor`.",
    })
    expect(result.readiness).toBe("degraded")
    expect(result.state).toBe("waiting")
    expect(result.summary).toContain("isolation is unavailable")
    // The remedy comes from the isolation authority, not a hardcoded doctor switch.
    expect(result.next[0]).toContain("bubblewrap")
  })

  test("reports governed workers ready only after a successful probe", () => {
    const result = workerSectionFromCheck({
      available: true,
      provider: "seatbelt",
      summary: "seatbelt; checkout-only writes; network denied",
    })
    expect(result.readiness).toBe("ready")
    expect(result.detail.join("\n")).toContain("network denied")
  })
})
