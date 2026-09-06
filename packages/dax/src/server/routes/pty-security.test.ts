import { expect, spyOn, test } from "bun:test"
import { Hono } from "hono"
import { Pty } from "../../pty"
import { PtyRoutes } from "./pty"
import { configureTransport } from "../transport-security"

test("PTY rejects a foreign websocket origin before accessing the terminal", async () => {
  configureTransport({ hostname: "127.0.0.1", ports: [4096] })
  const get = spyOn(Pty, "get").mockImplementation(() => {
    throw new Error("PTY reached")
  })
  try {
    const app = new Hono().route("/pty", PtyRoutes())
    const response = await app.request("http://localhost:4096/pty/test/connect", {
      headers: { upgrade: "websocket", origin: "http://localhost:7777" },
    })
    expect(response.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
  } finally {
    get.mockRestore()
  }
})
