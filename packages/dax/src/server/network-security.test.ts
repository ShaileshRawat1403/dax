import { expect, spyOn, test } from "bun:test"
import { Server } from "./server"
import * as Secrets from "../secrets/secrets-loader"
import { configureTransport } from "./transport-security"

test("the listening HTTP server rejects foreign hosts, cross-port origins and unauthorized roots", async () => {
  const secrets = spyOn(Secrets, "getSecrets").mockResolvedValue({
    source: { type: "env" },
    raw: new Map(),
    serverPassword: undefined,
    serverUsername: undefined,
    substrateToken: undefined,
    natsCreds: undefined,
    natsCredsData: undefined,
  })
  const server = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  try {
    expect((await fetch(new URL("/global/health", server.url))).status).toBe(200)
    expect(
      (
        await fetch(new URL("/global/health", server.url), {
          headers: { host: "evil.example" },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(new URL("/global/health", server.url), {
          headers: { origin: "http://localhost:7777" },
        })
      ).status,
    ).toBe(403)
    expect((await fetch(new URL("/file?directory=%2F", server.url))).status).toBe(403)
  } finally {
    await server.stop(true)
    configureTransport({ hostname: "127.0.0.1", ports: [4096] })
    secrets.mockRestore()
  }
})
