import { describe, expect, test } from "bun:test"
import { ModelsDev } from "./models"
import { Provider } from "./provider"

describe("current OpenAI model overlay", () => {
  test("exposes GPT-6 Astra with its current limits and supported efforts", async () => {
    const catalogue = await ModelsDev.get()
    const openai = Provider.fromModelsDevProvider(catalogue.openai!)
    const astra = openai.models["gpt-6-astra"]

    expect([
      "gpt-6-astra",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ].every((modelID) => openai.models[modelID] !== undefined)).toBe(true)
    expect(astra).toBeDefined()
    expect(astra.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(Object.keys(astra.variants ?? {})).toEqual(["low", "medium", "high", "xhigh", "max"])
  })
})
