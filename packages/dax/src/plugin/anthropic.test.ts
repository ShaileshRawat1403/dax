import { describe, expect, test } from "bun:test"
import { AnthropicAuthPlugin } from "./anthropic"

const provider = { id: "anthropic", name: "Anthropic", source: "api" as const, env: ["ANTHROPIC_API_KEY"], options: {}, models: {} }

const oauth = { type: "oauth" as const, access: "retired-access", refresh: "retired-refresh", expires: Date.now() + 60_000 }

describe("Anthropic API-only auth", () => {
  test("offers only API-key authentication and preserves API-key loading", async () => {
    const plugin = await AnthropicAuthPlugin()
    expect(plugin.auth?.methods.map((method) => method.type)).toEqual(["api"])
    expect(await plugin.auth!.loader!(async () => ({ type: "api", key: "fixture-key" }), provider)).toEqual({ apiKey: "fixture-key" })
  })

  test("does not create an OAuth fetch or refresh handler for stored tokens", async () => {
    const plugin = await AnthropicAuthPlugin()
    expect(await plugin.auth!.loader!(async () => oauth, provider)).toEqual({})
    expect(oauth.access).toBe("retired-access")
    expect(oauth.refresh).toBe("retired-refresh")
  })
})
