import { expect, spyOn, test } from "bun:test"
import { Hono } from "hono"
import { Server } from "./server"
import * as Secrets from "../secrets/secrets-loader"
import { configureTransport, transportSecurity } from "./transport-security"

test("host and origin rejection precedes authentication in the real app", async () => {
  configureTransport({ hostname: "127.0.0.1", ports: [4096] })
  const secrets = spyOn(Secrets, "getSecrets").mockImplementation(async () => {
    throw new Error("auth reached")
  })
  try {
    const attempts: Record<string, string>[] = [
      { host: "evil.example" },
      { host: "localhost.evil.example" },
      { host: "localhost", origin: "http://localhost:7777" },
      { host: "localhost", origin: "http://127.0.0.1:7777" },
      { host: "localhost", origin: "null" },
    ]
    for (const headers of attempts) {
      const response = await Server.App().request("http://localhost:4096/global/health", { headers })
      expect(response.status).toBe(403)
    }
    const preflight = await Server.App().request("http://localhost:4096/global/health", {
      method: "OPTIONS",
      headers: { host: "localhost", origin: "http://localhost:4096", "access-control-request-method": "GET" },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:4096")
    expect(secrets).not.toHaveBeenCalled()
  } finally {
    secrets.mockRestore()
  }
})

test("transport allows only configured origins and parses IPv6 host headers", async () => {
  configureTransport({ hostname: "service.example", ports: [4096], cors: ["https://operator.example"] })
  const app = new Hono().use(transportSecurity).get("/", (c) => c.text("ok"))
  try {
    for (const host of ["localhost:4096", "127.0.0.1:4096", "[::1]:4096", "service.example:4096"]) {
      expect(
        (await app.request("http://localhost/", { headers: { host, origin: "https://operator.example" } })).status,
      ).toBe(200)
    }
    for (const host of ["localhost@evil.example", "localhost/path", "[::1", "evil.example:4096"]) {
      expect((await app.request("http://localhost/", { headers: { host } })).status).toBe(403)
    }
    expect((await app.request("http://localhost/", { headers: { origin: "http://localhost:4096" } })).status).toBe(200)
    expect((await app.request("http://dax.internal/")).status).toBe(200)
    expect((await app.request("http://dax.internal/", { headers: { host: "dax.internal" } })).status).toBe(403)
  } finally {
    configureTransport({ hostname: "127.0.0.1", ports: [4096] })
  }
})
