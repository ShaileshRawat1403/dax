import { describe, expect, spyOn, test } from "bun:test"
import { ModelsDev } from "./models"
import { Provider } from "./provider"

// Hermetic catalogue: CI has neither a models.dev cache nor the generated
// (gitignored) models-snapshot.ts, so the overlay must be proven on fixture data.
const catalogue: Record<string, ModelsDev.Provider> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      "gpt-5.6": { ...ModelsDev.CurrentOpenAIModels["gpt-6-astra"]!, id: "gpt-5.6", name: "GPT-5.6", family: "gpt-sol" },
    },
  },
}

describe("current OpenAI model overlay", () => {
  test("exposes GPT-6 Astra with its current limits and supported efforts", async () => {
    const data = spyOn(ModelsDev, "Data").mockResolvedValue(catalogue)
    try {
      const openai = Provider.fromModelsDevProvider((await ModelsDev.get()).openai!)
      const astra = openai.models["gpt-6-astra"]

      expect(data).toHaveBeenCalled()
      // The overlay adds Astra and keeps every catalogue model.
      expect(Object.keys(openai.models).sort()).toEqual(["gpt-5.6", "gpt-6-astra"])
      expect(astra).toBeDefined()
      expect(astra.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(Object.keys(astra.variants ?? {})).toEqual(["low", "medium", "high", "xhigh", "max"])
    } finally {
      data.mockRestore()
    }
  })
})
