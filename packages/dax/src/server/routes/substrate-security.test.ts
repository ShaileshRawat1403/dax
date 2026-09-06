import { expect, spyOn, test } from "bun:test"
import { Flag } from "../../flag/flag"
import * as Secrets from "../../secrets/secrets-loader"
import { SubstrateRoutes } from "./substrate"
import { configureTransport } from "../transport-security"

test("standalone substrate routes require feature enablement, trusted transport and authentication", async () => {
  const enabled = Object.getOwnPropertyDescriptor(Flag, "DAX_SUBSTRATE_ENABLED")!
  Object.defineProperty(Flag, "DAX_SUBSTRATE_ENABLED", { ...enabled, value: true })
  configureTransport({ hostname: "127.0.0.1", ports: [4096, 4730] })
  const secrets = spyOn(Secrets, "getSecrets").mockResolvedValue({
    source: { type: "env" },
    raw: new Map(),
    serverPassword: undefined,
    serverUsername: undefined,
    substrateToken: "test-substrate-token",
    natsCreds: undefined,
    natsCredsData: undefined,
  })
  try {
    for (const [method, route] of [
      ["GET", "/sessions"],
      ["DELETE", "/sessions/test"],
      ["GET", "/"],
      ["POST", "/"],
    ]) {
      const response = await SubstrateRoutes.request("http://localhost:4730" + route, { method })
      expect(response.status).toBe(401)
    }
    const headers = { authorization: "Bearer test-substrate-token" }
    expect(
      (
        await SubstrateRoutes.request("http://localhost:4730/sessions", {
          headers: { ...headers, origin: "http://localhost:7777" },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await SubstrateRoutes.request("http://localhost:4730/sessions", {
          headers: { ...headers, host: "evil.example" },
        })
      ).status,
    ).toBe(403)
    const response = await SubstrateRoutes.request("http://localhost:4730/sessions", { headers })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [], count: 0, enabled: true })
    Object.defineProperty(Flag, "DAX_SUBSTRATE_ENABLED", { ...enabled, value: false })
    expect((await SubstrateRoutes.request("http://localhost:4730/sessions", { headers })).status).toBe(503)
  } finally {
    Object.defineProperty(Flag, "DAX_SUBSTRATE_ENABLED", enabled)
    configureTransport({ hostname: "127.0.0.1", ports: [4096] })
    secrets.mockRestore()
  }
})
