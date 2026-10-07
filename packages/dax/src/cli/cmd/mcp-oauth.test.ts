import { expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { McpAddCommand, McpDebugCommand } from "./mcp"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { McpOAuthProvider } from "@/mcp/oauth-provider"
import { McpAuth } from "@/mcp/auth"
import { MCP } from "@/mcp"

async function project(fn: (directory: string) => Promise<void>) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-mcp-cli-issuer-")))
  const previous = process.cwd()
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  process.chdir(directory)
  try {
    await fn(directory)
  } finally {
    await Instance.disposeAll()
    Config.global.reset()
    process.chdir(previous)
    await fs.rm(directory, { recursive: true, force: true })
  }
}

function quiet(): { mockRestore(): void }[] {
  return [
    spyOn(prompts, "intro").mockImplementation(() => {}),
    spyOn(prompts, "outro").mockImplementation(() => {}),
    ...(["info", "error", "warn", "success"] as const).map((key) =>
      spyOn(prompts.log, key).mockImplementation(() => {}),
    ),
    spyOn(prompts, "spinner").mockReturnValue({ start() {}, stop() {}, message() {} } as never),
  ]
}

test("MCP add writes a usable operator-supplied issuer for configured clients", async () => {
  await project(async (directory) => {
    let selectedOwnedConfig = false
    let requestedIssuer = false
    const mocks = quiet()
    mocks.push(
      spyOn(prompts, "select").mockImplementation(async <Value>(input: Parameters<typeof prompts.select<Value>>[0]) => {
        if (input.message === "Location") {
          selectedOwnedConfig = true
          return input.options[0].value
        }
        return input.options[1].value
      }),
    )
    mocks.push(
      spyOn(prompts, "confirm").mockImplementation(async (input) => input.message !== "Do you have a client secret?"),
    )
    mocks.push(
      spyOn(prompts, "text").mockImplementation(async (input) => {
        if (!selectedOwnedConfig) throw new Error("Fixture did not select its owned config")
        if (input.message === "Enter MCP server name") return "owned"
        if (input.message === "Enter MCP server URL") return "https://mcp.example/mcp"
        if (input.message === "Enter client ID") return "owned-client"
        requestedIssuer = true
        expect(input.validate?.("https://user:secret@auth.example/")).toBeTruthy()
        expect(input.validate?.("not-an-issuer")).toBeTruthy()
        expect(input.validate?.("https://auth.example/")).toBeUndefined()
        return "https://auth.example/"
      }),
    )
    try {
      await McpAddCommand.handler({} as never)
      expect(requestedIssuer).toBe(true)
      const saved = JSON.parse(await fs.readFile(path.join(directory, "dax.json"), "utf8"))
      expect(saved.mcp.owned.oauth).toEqual({ clientId: "owned-client", expectedIssuer: "https://auth.example/" })
      expect(
        await new McpOAuthProvider("owned", saved.mcp.owned.url, saved.mcp.owned.oauth, {
          onRedirect() {},
        }).clientInformation(),
      ).toMatchObject({ client_id: "owned-client", issuer: "https://auth.example/" })
    } finally {
      for (const mock of mocks.reverse()) mock.mockRestore()
    }
  })
})

test("MCP debug forwards the configured issuer into its real SDK provider", async () => {
  await project(async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request): Response {
        const root = `http://127.0.0.1:${server.port}/`
        if (request.method === "POST") return new Response("Unauthorized", { status: 401 })
        if (request.url.includes("oauth-protected-resource"))
          return Response.json({ resource: `${root}mcp`, authorization_servers: [root] })
        return Response.json({
          issuer: root,
          authorization_endpoint: `${root}authorize`,
          token_endpoint: `${root}token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        })
      },
    })
    const issuer = `http://127.0.0.1:${server.port}/`
    const mocks = quiet()
    mocks.push(
      spyOn(Config, "get").mockResolvedValue({
        mcp: {
          owned: {
            type: "remote",
            url: `${issuer}mcp`,
            oauth: { clientId: "owned-debug-client", expectedIssuer: issuer },
          },
        },
      }) as never,
    )
    let actual: Awaited<ReturnType<McpOAuthProvider["clientInformation"]>>
    const original = McpOAuthProvider.prototype.clientInformation
    mocks.push(
      spyOn(McpOAuthProvider.prototype, "clientInformation").mockImplementation(async function (
        this: McpOAuthProvider,
      ) {
        actual = await original.call(this)
        throw new Error("controlled stop after genuine client-information boundary")
      }) as never,
    )
    try {
      await McpDebugCommand.handler({ name: "owned" } as never)
      expect(actual).toMatchObject({ client_id: "owned-debug-client", issuer })
    } finally {
      for (const mock of mocks.reverse()) mock.mockRestore()
      await server.stop(true)
    }
  })
})

test("issuerless historical tokens are displayed as needing authentication", async () => {
  const name = `owned-status-${crypto.randomUUID()}`
  const url = "https://mcp.example/mcp"
  const config = spyOn(Config, "get").mockResolvedValue({ mcp: { [name]: { type: "remote", url } } })
  try {
    await McpAuth.set(name, { tokens: { accessToken: "owned-access" } }, url)
    const before = await McpAuth.get(name)
    expect(await MCP.getAuthStatus(name)).toBe("not_authenticated")
    expect(await McpAuth.get(name)).toEqual(before)
    await McpAuth.set(name, { tokens: { accessToken: "owned-access", issuer: "https://auth.example/" } }, url)
    expect(await MCP.getAuthStatus(name)).toBe("authenticated")
    config.mockResolvedValue({ mcp: { [name]: { type: "remote", url: "https://different.example/mcp" } } })
    expect(await MCP.getAuthStatus(name)).toBe("not_authenticated")
  } finally {
    config.mockRestore()
    await McpAuth.remove(name)
  }
})
