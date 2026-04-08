import { describe, expect, test } from "bun:test"
import { cliImportCredSignature, isCliImportReady, waitForCliImportCreds } from "./gemini"

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
