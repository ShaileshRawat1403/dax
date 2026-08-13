import { describe, expect, test } from "bun:test"
import { MCPRegistry, MCPServerInfo, MCPServerListResponse } from "./registry"

// Focused coverage: the pure install-command derivation and the registry
// schemas. The connection, catalog, and OAuth paths in mcp/index.ts are thin
// wrappers over the MCP SDK and remain integration-tested only — testing them
// here would mean standing up a fake MCP server, which is out of scope.

function server(overrides: Partial<MCPServerInfo> = {}): MCPServerInfo {
  return { name: "example-server", ...overrides }
}

describe("MCPRegistry.getInstallCommand", () => {
  test("an npm package resolves to an npx command", async () => {
    expect(
      await MCPRegistry.getInstallCommand(server({ packages: [{ registryType: "npm", identifier: "@scope/pkg" }] })),
    ).toBe("npx -y @scope/pkg")
  })

  test("a pip package resolves to a pip install command", async () => {
    expect(
      await MCPRegistry.getInstallCommand(server({ packages: [{ registryType: "pip", identifier: "mcp-pkg" }] })),
    ).toBe("pip install mcp-pkg")
  })

  test("a go package resolves to a go install command", async () => {
    expect(
      await MCPRegistry.getInstallCommand(server({ packages: [{ registryType: "go", identifier: "example.com/mcp" }] })),
    ).toBe("go install example.com/mcp")
  })

  test("an unknown registry type falls back to a generic install hint", async () => {
    expect(
      await MCPRegistry.getInstallCommand(server({ packages: [{ registryType: "cargo", identifier: "crate-x" }] })),
    ).toBe("Install from: crate-x")
  })

  test("a package-less server with a remote yields a dax.json config snippet", async () => {
    const cmd = await MCPRegistry.getInstallCommand(
      server({ name: "remote-srv", remotes: [{ type: "sse", url: "https://host/mcp" }] }),
    )
    expect(cmd).toContain("Add to dax.json")
    expect(cmd).toContain("remote-srv")
    expect(cmd).toContain("https://host/mcp")
  })

  test("a server with neither a package nor a remote yields null", async () => {
    expect(await MCPRegistry.getInstallCommand(server())).toBeNull()
  })
})

describe("MCP registry schemas", () => {
  test("a well-formed server validates", () => {
    const parsed = MCPServerInfo.safeParse({
      name: "srv",
      description: "d",
      packages: [{ registryType: "npm", identifier: "pkg", version: "1.0.0" }],
      status: "active",
    })
    expect(parsed.success).toBeTrue()
  })

  test("a server missing its name is rejected", () => {
    expect(MCPServerInfo.safeParse({ description: "no name" }).success).toBeFalse()
  })

  test("an out-of-enum status is rejected", () => {
    expect(MCPServerInfo.safeParse({ name: "srv", status: "unknown" }).success).toBeFalse()
  })

  test("a list response validates", () => {
    expect(MCPServerListResponse.safeParse({ servers: [{ name: "a" }, { name: "b" }], total: 2 }).success).toBeTrue()
  })
})
