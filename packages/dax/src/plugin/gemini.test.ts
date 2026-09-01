import { describe, expect, test } from "bun:test"
import {
  cliImportCredSignature,
  cloudCodeProjectID,
  isCliImportReady,
  parseCliCreds,
  waitForCliImportCreds,
} from "./gemini"

describe("Google Code Assist project resolution", () => {
  test("normalizes the companion project id returned by Code Assist", () => {
    expect(cloudCodeProjectID("companion-project")).toBe("companion-project")
    expect(cloudCodeProjectID({ id: "companion-project" })).toBe("companion-project")
  })

  test("rejects malformed companion project values instead of using a default project", () => {
    expect(cloudCodeProjectID({ id: "" })).toBeUndefined()
    expect(cloudCodeProjectID({ project: "default" })).toBeUndefined()
    expect(cloudCodeProjectID(undefined)).toBeUndefined()
  })
})

describe("gemini CLI import readiness", () => {
  test("stale baseline credentials are not considered ready", () => {
    expect(
      isCliImportReady({
        access: "stale-access",
        refresh: "refresh-token",
        expires: Date.now() - 1_000,
      }),
    ).toBe(false)
  })

  test("healthy baseline credentials are considered ready", () => {
    expect(
      isCliImportReady({
        access: "fresh-access",
        refresh: "refresh-token",
        expires: Date.now() + 120_000,
      }),
    ).toBe(true)
  })

  test("signature changes when CLI credentials are refreshed", () => {
    const oldCreds = {
      access: "old-access",
      refresh: "refresh-token",
      expires: 100,
      clientID: "client-id",
      clientSecret: "client-secret",
    }
    const newCreds = {
      ...oldCreds,
      access: "new-access",
      expires: 200,
    }

    expect(cliImportCredSignature(oldCreds)).not.toBe(cliImportCredSignature(newCreds))
  })

  test("waitForCliImportCreds ignores unchanged stale CLI creds and accepts refreshed ones", async () => {
    const baseline = {
      access: "stale-access",
      refresh: "refresh-token",
      expires: Date.now() - 1_000,
      clientID: "client-id",
      clientSecret: "client-secret",
    }

    const sequence = [
      baseline,
      baseline,
      {
        ...baseline,
        access: "fresh-access",
        expires: Date.now() + 120_000,
      },
    ]

    const read = async () => sequence.shift()

    const result = await waitForCliImportCreds({
      baseline,
      read,
      timeoutMs: 50,
      stepMs: 0,
    })

    expect(result?.access).toBe("fresh-access")
  })
})

describe("Antigravity credential parsing", () => {
  test("parses nested Antigravity token structure", () => {
    const creds = {
      auth_method: "consumer",
      token: {
        access_token: "ya29.test-access-token",
        refresh_token: "1//test-refresh-token",
        expiry: "2026-08-31T15:00:00.000Z",
        token_type: "Bearer",
      },
    }
    const parsed = parseCliCreds(creds, "/home/user/.gemini/antigravity-cli/antigravity-oauth-token")
    expect(parsed).toBeDefined()
    expect(parsed?.access).toBe("ya29.test-access-token")
    expect(parsed?.refresh).toBe("1//test-refresh-token")
    expect(parsed?.expires).toBe(new Date("2026-08-31T15:00:00.000Z").getTime())
    expect(parsed?.mode).toBe("antigravity-import")
  })

  test("parses standard flat CLI format", () => {
    const creds = {
      access_token: "ya29.flat-access-token",
      refresh_token: "1//flat-refresh-token",
      expiry_date: 1788167000000,
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    }
    const parsed = parseCliCreds(creds, "/home/user/.gemini/oauth_creds.json")
    expect(parsed).toBeDefined()
    expect(parsed?.access).toBe("ya29.flat-access-token")
    expect(parsed?.refresh).toBe("1//flat-refresh-token")
    expect(parsed?.expires).toBe(1788167000000)
    expect(parsed?.clientID).toBe("test-client-id")
    expect(parsed?.clientSecret).toBe("test-client-secret")
    expect(parsed?.mode).toBe("cli-import")
  })
})
