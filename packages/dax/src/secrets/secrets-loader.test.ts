import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  getSecrets,
  loadSecrets,
  resetSecretsCache,
  type SecretEntry,
  type SecretsProvider,
  type SecretsSource,
} from "./secrets-loader"

function provider(
  secrets: SecretEntry[],
  source: SecretsSource = { type: "infisical", projectId: "p", environment: "test" },
): SecretsProvider {
  return { getAll: async () => secrets, source }
}

afterEach(() => resetSecretsCache())

describe("secrets loader", () => {
  test("provider secrets populate the resolved fields and raw map", async () => {
    const resolved = await loadSecrets(
      provider([
        { secretName: "DAX_SUBSTRATE_TOKEN", secretValue: "tok" },
        { secretName: "DAX_SERVER_USERNAME", secretValue: "user" },
        { secretName: "DAX_SERVER_PASSWORD", secretValue: "pass" },
      ]),
    )
    expect(resolved.substrateToken).toBe("tok")
    expect(resolved.serverUsername).toBe("user")
    expect(resolved.serverPassword).toBe("pass")
    expect(resolved.source.type).toBe("infisical")
    expect(resolved.raw.get("DAX_SUBSTRATE_TOKEN")).toBe("tok")
  })

  test("provider value is used for a key it supplies (precedence over env fallback)", async () => {
    // loadSecrets resolves each field as `providerMap.get(k) ?? Flag[k]`, so a
    // key the provider supplies must win over the environment fallback.
    const resolved = await loadSecrets(provider([{ secretName: "DAX_SUBSTRATE_TOKEN", secretValue: "from-provider" }]))
    expect(resolved.substrateToken).toBe("from-provider")
  })

  test("an empty provider yields its own source and no secrets (env fallback side)", async () => {
    const resolved = await loadSecrets(provider([], { type: "env" }))
    expect(resolved.source).toEqual({ type: "env" })
    expect(resolved.raw.size).toBe(0)
    expect(resolved.substrateToken).toBeUndefined()
  })

  test("a NATS creds path is read from disk into bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dax-secrets-"))
    const credsPath = join(dir, "nats.creds")
    writeFileSync(credsPath, "creds-bytes")
    try {
      const resolved = await loadSecrets(provider([{ secretName: "DAX_NATS_CREDS_PATH", secretValue: credsPath }]))
      expect(resolved.natsCreds).toBe(credsPath)
      expect(new TextDecoder().decode(resolved.natsCredsData)).toBe("creds-bytes")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a missing NATS creds file fails closed to undefined without throwing", async () => {
    const resolved = await loadSecrets(
      provider([{ secretName: "DAX_NATS_CREDS_PATH", secretValue: "/no/such/path/nats.creds" }]),
    )
    expect(resolved.natsCreds).toBe("/no/such/path/nats.creds")
    expect(resolved.natsCredsData).toBeUndefined()
  })

  test("resetSecretsCache forces a fresh load", async () => {
    const first = await getSecrets()
    expect(await getSecrets()).toBe(first) // cached: same instance
    resetSecretsCache()
    expect(await getSecrets()).not.toBe(first) // reloaded after reset
  })
})
