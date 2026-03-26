import { describe, expect, test } from "bun:test"
import { isGeminiSubscriptionLane, hasGeminiApiKeyEnv } from "./gemini-subscription"

describe("gemini subscription lane helpers", () => {
  test("detects active Gemini subscription auth without API key env", () => {
    expect(
      isGeminiSubscriptionLane({
        providerID: "google",
        auth: {
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          mode: "cli-import",
        },
        env: {},
      }),
    ).toBe(true)
  })

  test("does not treat API key mode as subscription lane", () => {
    expect(
      isGeminiSubscriptionLane({
        providerID: "google",
        auth: {
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          mode: "cli-import",
        },
        env: {
          GEMINI_API_KEY: "key",
        },
      }),
    ).toBe(false)
  })

  test("only applies to the Google provider", () => {
    expect(
      isGeminiSubscriptionLane({
        providerID: "openai",
        auth: {
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          mode: "cli-import",
        },
        env: {},
      }),
    ).toBe(false)
  })

  test("detects supported API key env names", () => {
    expect(hasGeminiApiKeyEnv({ GOOGLE_API_KEY: "key" })).toBe(true)
    expect(hasGeminiApiKeyEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "key" })).toBe(true)
    expect(hasGeminiApiKeyEnv({})).toBe(false)
  })
})
