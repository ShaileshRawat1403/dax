import { expect, spyOn, test } from "bun:test"
import { Server } from "./server"
import { Instance } from "../project/instance"
import * as Secrets from "../secrets/secrets-loader"
import { configureTransport } from "./transport-security"

test("unmatched methods and bodies are never relayed to a remote host", async () => {
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
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        throw new Error("outbound request")
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  try {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await Server.App().request("http://localhost:4096/unknown-route", {
        method,
        ...(method === "GET" ? {} : { body: "private request data" }),
      })
      expect(response.status).toBe(404)
    }
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
    provide.mockRestore()
    secrets.mockRestore()
  }
})
