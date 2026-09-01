import { describe, expect, test } from "bun:test"
import {
  classifyProviderFailure,
  describeProviderFailure,
  providerFailureNextStep,
  providerLaneLabel,
} from "./diagnostics"

describe("provider diagnostics normalization", () => {
  test("returns canonical lane labels", () => {
    expect(providerLaneLabel("gemini-cli-import")).toBe("Gemini CLI Import (enterprise legacy)")
    expect(providerLaneLabel("anthropic-subscription")).toBe("Claude Pro/Max Sign-In")
    expect(providerLaneLabel("openai-chatgpt")).toBe("ChatGPT Plus/Pro Sign-In")
  })

  test("classifies rate limits and model availability consistently", () => {
    expect(classifyProviderFailure({ message: "429 rate_limit_error from provider" })).toBe("rate_limited")
    expect(classifyProviderFailure({ message: "model not found" })).toBe("model_unavailable")
  })

  test("keeps unknown failures honest", () => {
    expect(classifyProviderFailure({ message: "unexpected upstream weirdness" })).toBe("unknown")
  })

  test("gives lane-specific next steps for gemini cli import auth gaps", () => {
    const failure = describeProviderFailure({
      providerID: "google",
      lane: "gemini-cli-import",
      errorName: "ProviderAuthOauthMissing",
    })

    expect(failure.category).toBe("auth_missing")
    expect(failure.laneLabel).toBe("Gemini CLI Import (enterprise legacy)")
    expect(failure.nextStep).toContain("worker run antigravity")
  })

  test("gives lane-specific next steps for Antigravity session import auth gaps", () => {
    const failure = describeProviderFailure({
      providerID: "google",
      lane: "antigravity-import",
      errorName: "ProviderAuthOauthMissing",
    })

    expect(failure.category).toBe("auth_missing")
    expect(failure.laneLabel).toBe("Antigravity (governed worker)")
    expect(failure.nextStep).toContain("worker run antigravity")
  })

  test("provides an honest fallback next step for unknown failures", () => {
    const next = providerFailureNextStep({
      category: "unknown",
      providerID: "openai",
      lane: "openai-chatgpt",
    })

    expect(next).toContain("dax doctor auth --json")
  })
})
