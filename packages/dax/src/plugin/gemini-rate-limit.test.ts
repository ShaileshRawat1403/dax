import { describe, expect, test } from "bun:test"
import {
  DEFAULT_GEMINI_SUBSCRIPTION_RETRY_MS,
  parseGeminiSubscriptionRetryMs,
  shouldWaitForGeminiSubscriptionCooldown,
} from "./gemini-rate-limit"

describe("Gemini subscription rate limit helpers", () => {
  test("prefers retry-after-ms when available", () => {
    expect(
      parseGeminiSubscriptionRetryMs({
        retryAfterMs: "4200",
        retryAfter: "12",
        message: "Retry after 9s",
      }),
    ).toBe(4200)
  })

  test("parses retry-after seconds and response message fallback", () => {
    expect(
      parseGeminiSubscriptionRetryMs({
        retryAfter: "7",
      }),
    ).toBe(7000)

    expect(
      parseGeminiSubscriptionRetryMs({
        message: "Rate limit hit, retry after 11s",
      }),
    ).toBe(11_000)
  })

  test("returns default retry delay when no hints are present", () => {
    expect(parseGeminiSubscriptionRetryMs({})).toBe(DEFAULT_GEMINI_SUBSCRIPTION_RETRY_MS)
  })

  test("waits only while cooldown is active", () => {
    expect(shouldWaitForGeminiSubscriptionCooldown(2_000, 1_000)).toBe(1000)
    expect(shouldWaitForGeminiSubscriptionCooldown(1_000, 2_000)).toBe(0)
  })
})
