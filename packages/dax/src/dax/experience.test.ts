import { describe, expect, test } from "bun:test"
import { chooseMcpCapability, summarizeMcpReadiness } from "./experience"

describe("product experience helpers", () => {
  test("selects the most useful MCP capability first", () => {
    const capability = chooseMcpCapability({
      name: "workspace_kernel",
      tools: [
        { name: "kernel_version" },
        { name: "repo_search" },
        { name: "read_file" },
      ],
    })

    expect(capability?.tool).toBe("repo_search")
    expect(capability?.label).toContain("safe repo search")
  })

  test("falls back to the first tool when no priority tool is present", () => {
    const capability = chooseMcpCapability({
      name: "workspace_kernel",
      tools: [{ name: "custom_lookup", description: "Inspect custom metadata." }],
    })

    expect(capability).toEqual({
      server: "workspace_kernel",
      tool: "custom_lookup",
      label: "Inspect custom metadata.",
    })
  })

  test("summarizes MCP readiness with capability guidance", () => {
    const result = summarizeMcpReadiness({
      configured: 1,
      failed: 0,
      blocked: 0,
      connected: 1,
      capability: {
        server: "workspace_kernel",
        tool: "repo_search",
        label: "Best available first use: safe repo search.",
      },
    })

    expect(result.state).toBe("connected")
    expect(result.summary).toContain("safe repo search")
  })

  test("summarizes failed and unconfigured MCP states", () => {
    expect(
      summarizeMcpReadiness({
        configured: 0,
        failed: 0,
        blocked: 0,
        connected: 0,
      }),
    ).toEqual({
      state: "waiting",
      summary: "No MCP server configured. Optional, but useful for richer read-only workspace tooling.",
    })

    expect(
      summarizeMcpReadiness({
        configured: 2,
        failed: 1,
        blocked: 0,
        connected: 0,
      }),
    ).toEqual({
      state: "failed",
      summary: "1 MCP server failed to start.",
    })
  })
})
