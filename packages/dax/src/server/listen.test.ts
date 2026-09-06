import { expect, spyOn, test } from "bun:test"
import { Server } from "./server"
import * as Secrets from "../secrets/secrets-loader"
import { Config } from "../config/config"
import { resolveNetworkOptions } from "../cli/network"

test("listen checks resolved secrets before opening a non-loopback socket", async () => {
  const secrets = spyOn(Secrets, "getSecrets").mockResolvedValue({
    source: { type: "env" }, raw: new Map(), serverPassword: undefined, serverUsername: undefined,
    substrateToken: undefined, natsCreds: undefined, natsCredsData: undefined,
  })
  const serve = spyOn(Bun, "serve").mockImplementation(() => { throw new Error("socket attempted") })
  const config = spyOn(Config, "global").mockResolvedValue({})
  try {
    for (const hostname of ["0.0.0.0", "::", "192.168.1.10", "example.test"]) {
      await expect(Server.listen({ hostname, port: 0 })).rejects.toThrow("DAX_SERVER_PASSWORD is required")
    }
    const mdns = await resolveNetworkOptions({
      port: 0, hostname: "127.0.0.1", mdns: true, "mdns-domain": "dax.local", cors: [],
      "allow-unauthenticated": false,
    })
    expect(mdns.hostname).toBe("0.0.0.0")
    await expect(Server.listen(mdns)).rejects.toThrow("DAX_SERVER_PASSWORD is required")
    expect(serve).not.toHaveBeenCalled()

    for (const hostname of ["127.0.0.1", "localhost", "::1"]) {
      await expect(Server.listen({ hostname, port: 1 })).rejects.toThrow("socket attempted")
    }
    await expect(Server.listen({ hostname: "0.0.0.0", port: 1, allowUnauthenticated: true }))
      .rejects.toThrow("socket attempted")
    secrets.mockResolvedValue({
      source: { type: "env" }, raw: new Map(), serverPassword: "configured-password", serverUsername: undefined,
      substrateToken: undefined, natsCreds: undefined, natsCredsData: undefined,
    })
    await expect(Server.listen({ hostname: "0.0.0.0", port: 1 })).rejects.toThrow("socket attempted")
    expect(serve).toHaveBeenCalledTimes(5)
  } finally {
    secrets.mockRestore()
    serve.mockRestore()
    config.mockRestore()
  }
})
