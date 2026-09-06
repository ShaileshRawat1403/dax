import { expect, spyOn, test } from "bun:test"
import { Server } from "./server"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import * as Secrets from "../secrets/secrets-loader"
import { configureTransport } from "./transport-security"

test("unexpected HTTP errors expose an opaque reference instead of a stack trace", async () => {
  configureTransport({ hostname: "127.0.0.1", ports: [4096] })
  const provide = spyOn(Instance, "provide").mockImplementation(async (input) => input.fn())
  const secrets = spyOn(Secrets, "getSecrets").mockResolvedValue({
    source: { type: "env" },
    raw: new Map(),
    serverPassword: undefined,
    serverUsername: undefined,
    substrateToken: undefined,
    natsCreds: undefined,
    natsCredsData: undefined,
  })
  const list = spyOn(Agent, "list").mockImplementation(async () => {
    throw new Error("private diagnostic /Users/example/.dax/secret")
  })
  try {
    const response = await Server.App().request("http://localhost:4096/agent")
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain("private diagnostic")
    expect(text).not.toContain("/Users/")
    expect(text).not.toContain(".test.ts")
    expect(text).toMatch(/Internal server error\. Reference: [0-9a-f-]{36}/)
  } finally {
    provide.mockRestore()
    secrets.mockRestore()
    list.mockRestore()
  }
})
