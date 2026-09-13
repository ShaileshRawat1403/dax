import { describe, expect, test } from "bun:test"
import { isGpt5OrLater, isGpt56Family, isGpt6Astra, openAIGptMajor } from "./openai-model-id"

describe("OpenAI GPT model identity", () => {
  test("recognizes modern numbered GPT families without matching unrelated IDs", () => {
    expect(openAIGptMajor("gpt-5.6-sol")).toBe(5)
    expect(openAIGptMajor("gpt-6-astra")).toBe(6)
    expect(isGpt5OrLater("gpt-6-astra")).toBe(true)
    expect(isGpt5OrLater("gpt-4.1")).toBe(false)
    expect(isGpt5OrLater("gpt-oss-120b")).toBe(false)
  })

  test("keeps release-specific families exact", () => {
    expect(isGpt56Family("gpt-5.6")).toBe(true)
    expect(isGpt56Family("gpt-5.6-terra")).toBe(true)
    expect(isGpt56Family("gpt-5.5")).toBe(false)
    expect(isGpt6Astra("gpt-6-astra")).toBe(true)
    expect(isGpt6Astra("gpt-6-astra-preview")).toBe(false)
  })
})
