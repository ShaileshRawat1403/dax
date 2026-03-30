import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import { classifyMcpReadiness, doctorExitCode, formatDoctorSection } from "./index"

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
})
