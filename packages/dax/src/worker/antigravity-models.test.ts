import { afterEach, describe, expect, test } from "bun:test"
import {
  discoverAntigravityModels,
  parseAntigravityModels,
  requireAntigravityModel,
  resetAntigravityModelCacheForTest,
} from "./antigravity-models"

afterEach(resetAntigravityModelCacheForTest)

const output = [
  "Fetching available models...",
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
  "",
].join("\n")

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    throw new Error("expected promise to reject")
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe("Antigravity model discovery", () => {
  test("parses every authenticated model and preserves CLI order", () => {
    expect(parseAntigravityModels(output)).toEqual([
      { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
      { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
      { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
    ])
  })

  test("rejects malformed, unsafe, duplicate, and empty catalogues", () => {
    expect(() => parseAntigravityModels("unexpected banner")).toThrow("unrecognized line")
    expect(() => parseAntigravityModels("../escape\tUnsafe")).toThrow()
    expect(() => parseAntigravityModels("model-a\tA\nmodel-a\tA again")).toThrow("duplicate")
    expect(() => parseAntigravityModels("Fetching available models...\n")).toThrow("no models")
  })

  test("executes the resolved binary directly and caches a bounded result", async () => {
    const calls: Array<[string, number]> = []
    const run = async (binary: string, timeoutMs: number) => {
      calls.push([binary, timeoutMs])
      return { exitCode: 0, stdout: output, stderr: "" }
    }
    const options = { which: () => "/opt/agy/bin/agy", run, now: () => 1_000 }
    const first = await discoverAntigravityModels(options)
    first[0]!.name = "mutated caller copy"
    const second = await discoverAntigravityModels(options)

    expect(calls).toEqual([["/opt/agy/bin/agy", 15_000]])
    expect(second[0]?.name).toBe("Gemini 3.8 Flash (High)")
  })

  test("fails closed on missing binary, timeout, and nonzero exit", async () => {
    expect(await rejectionMessage(discoverAntigravityModels({ which: () => null }))).toContain("not installed")
    expect(
      await rejectionMessage(
        discoverAntigravityModels({
          forceRefresh: true,
          which: () => "/agy",
          run: async () => ({ exitCode: -1, stdout: "", stderr: "", timedOut: true }),
        }),
      ),
    ).toContain("timed out")
    expect(
      await rejectionMessage(
        discoverAntigravityModels({
          forceRefresh: true,
          which: () => "/agy",
          run: async () => ({ exitCode: 1, stdout: "", stderr: "not signed in" }),
        }),
      ),
    ).toContain("not signed in")
  })

  test("requires an exact model returned for the authenticated account", () => {
    const models = parseAntigravityModels(output)
    expect(requireAntigravityModel("gemini-3.8-flash-high", models).name).toContain("Gemini 3.8")
    expect(() => requireAntigravityModel(undefined, models)).toThrow("explicit model")
    expect(() => requireAntigravityModel("gemini-not-available", models)).toThrow("not available")
  })
})
