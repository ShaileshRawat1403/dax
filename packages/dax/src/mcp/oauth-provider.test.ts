import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { auth } from "@modelcontextprotocol/sdk/client/auth.js"
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"
import { McpAuth } from "./auth"
import { McpOAuthProvider } from "./oauth-provider"

const issuer = "https://trusted.example/"
const serverUrl = "https://mcp.example/mcp"
const makeProvider = (name: string, config = {}) =>
  new McpOAuthProvider(name, serverUrl, config, {
    onRedirect() {
      throw new Error("interactive-sign-in-required")
    },
  })

async function owned(fn: (name: string) => Promise<void>) {
  const name = `oauth-issuer-${crypto.randomUUID()}`
  try {
    await fn(name)
  } finally {
    await McpAuth.remove(name)
  }
}

test("OAuth persistence round-trips issuer and rejects unstamped saves", async () => {
  await owned(async (name) => {
    const provider = makeProvider(name)
    await provider.saveClientInformation({
      client_id: "registered",
      client_secret: "owned-secret",
      issuer,
      redirect_uris: [provider.redirectUrl],
    })
    await provider.saveTokens({
      access_token: "owned-access",
      refresh_token: "owned-refresh",
      token_type: "Bearer",
      issuer,
    })
    expect(await provider.clientInformation()).toMatchObject({ client_id: "registered", issuer })
    expect(await provider.tokens()).toMatchObject({
      access_token: "owned-access",
      refresh_token: "owned-refresh",
      issuer,
    })
    const before = await McpAuth.get(name)
    await assert.rejects(
      provider.saveTokens({ access_token: "replacement", token_type: "Bearer" }),
      /mcp_oauth_issuer_required/,
    )
    await assert.rejects(
      provider.saveClientInformation({ client_id: "replacement", redirect_uris: [provider.redirectUrl] }),
      /mcp_oauth_issuer_required/,
    )
    expect(await McpAuth.get(name)).toEqual(before)
  })
})

test("legacy issuerless credentials remain stored but are never offered", async () => {
  await owned(async (name) => {
    await McpAuth.set(
      name,
      {
        tokens: { accessToken: "old-access", refreshToken: "old-refresh" },
        clientInfo: { clientId: "old-client", clientSecret: "old-secret" },
      },
      serverUrl,
    )
    const before = await McpAuth.get(name)
    const provider = makeProvider(name)
    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
    expect(await McpAuth.get(name)).toEqual(before)
  })
})

test("pre-registered clients require an explicit safe issuer", async () => {
  await owned(async (name) => {
    for (const expectedIssuer of [undefined, "not-a-url", "https://user:secret@trusted.example/", "file:///tmp/auth"]) {
      await assert.rejects(
        makeProvider(name, { clientId: "client", clientSecret: "secret", expectedIssuer }).clientInformation(),
        /mcp_oauth_issuer_required/,
      )
    }
    expect(
      await makeProvider(name, {
        clientId: "client",
        clientSecret: "secret",
        expectedIssuer: issuer,
      }).clientInformation(),
    ).toMatchObject({ issuer, client_id: "client" })
  })
})

for (const changed of [false, true]) {
  test(`real SDK ${changed ? "refuses cross-issuer credential reuse" : "refreshes only at the bound issuer"}`, async () => {
    await owned(async (name) => {
      const provider = makeProvider(name)
      await provider.saveClientInformation({
        client_id: "owned-client",
        client_secret: "owned-secret",
        issuer,
        redirect_uris: [provider.redirectUrl],
      })
      await provider.saveTokens({
        access_token: "owned-access",
        refresh_token: "owned-refresh",
        token_type: "Bearer",
        issuer,
      })
      await provider.saveState("owned-state")
      const selectedIssuer = changed ? "https://attacker.example/" : issuer
      const requests: { url: string; body: string; headers: string }[] = []
      const fetchFn: FetchLike = async (input, init) => {
        const url = String(input)
        requests.push({
          url,
          body: String(init?.body ?? ""),
          headers: JSON.stringify(Object.fromEntries(new Headers(init?.headers))),
        })
        const value = url.includes("oauth-protected-resource")
          ? { resource: serverUrl, authorization_servers: [selectedIssuer] }
          : url.endsWith("/token")
            ? { access_token: "fresh-access", token_type: "Bearer", refresh_token: "fresh-refresh" }
            : url.endsWith("/register")
              ? { client_id: "new-client", redirect_uris: [provider.redirectUrl] }
              : {
                  issuer: selectedIssuer,
                  authorization_endpoint: `${selectedIssuer}authorize`,
                  token_endpoint: `${selectedIssuer}token`,
                  registration_endpoint: `${selectedIssuer}register`,
                  response_types_supported: ["code"],
                  code_challenge_methods_supported: ["S256"],
                }
        return Response.json(value)
      }
      if (changed) {
        await assert.rejects(auth(provider, { serverUrl, fetchFn }), /interactive-sign-in-required/)
        expect(requests.some((request) => request.url.endsWith("/token"))).toBe(false)
        for (const secret of ["owned-secret", "owned-refresh", "owned-access"])
          expect(JSON.stringify(requests)).not.toContain(secret)
        expect((await provider.tokens())?.issuer).toBe(issuer)
      } else {
        expect(await auth(provider, { serverUrl, fetchFn })).toBe("AUTHORIZED")
        const tokenRequest = requests.find((request) => request.url.endsWith("/token"))!
        expect(tokenRequest.url).toBe(`${issuer}token`)
        expect(tokenRequest.body).toContain("owned-refresh")
        expect(await provider.tokens()).toMatchObject({ issuer, access_token: "fresh-access" })
      }
    })
  })
}
