import { describe, expect, test } from "bun:test"
import {
  buildCodexModel,
  CODEX_SUBSCRIPTION_FALLBACKS,
  isSubscriptionModel,
} from "./codex"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "@/session/system"

describe("Codex subscription model catalogue", () => {
  test("contains the current OpenAI Codex families in newest-first order", () => {
    expect(CODEX_SUBSCRIPTION_FALLBACKS.map((model) => model.id)).toEqual([
      "gpt-6-astra",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.3-codex-spark",
    ])
  })

  test("does not retain explicitly retired subscription fallbacks", () => {
    expect(isSubscriptionModel("gpt-5.4")).toBe(false)
    expect(isSubscriptionModel("gpt-5.4-mini")).toBe(false)
    expect(isSubscriptionModel("gpt-5.3-codex")).toBe(false)
    expect(isSubscriptionModel("gpt-5.3-codex-spark")).toBe(true)
  })

  test("builds current model names, limits, and reasoning variants", () => {
    const astra = buildCodexModel("gpt-6-astra", "2026-09-04")
    const sol = buildCodexModel("gpt-5.6-sol", "2026-07-09")

    expect(astra.name).toBe("GPT-6 Astra")
    expect(astra.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(Object.keys(astra.variants)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(sol.name).toBe("GPT-5.6 Sol")
    expect(sol.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(Object.keys(sol.variants)).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
  })

  test("routes current GPT models through modern OpenAI defaults and the DAX system prompt", () => {
    const astra = buildCodexModel("gpt-6-astra", "2026-09-04")
    const options = ProviderTransform.options({ model: astra, sessionID: "session_1" })

    expect(options).toMatchObject({
      store: false,
      promptCacheKey: "session_1",
      reasoningEffort: "medium",
      reasoningSummary: "auto",
      textVerbosity: "low",
    })
    expect(ProviderTransform.smallOptions(astra)).toEqual({ store: false, reasoningEffort: "low" })
    expect(SystemPrompt.provider(astra)[0]?.trim()).toBe(SystemPrompt.instructions())
  })
})
