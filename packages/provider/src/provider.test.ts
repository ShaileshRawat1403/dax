import { describe, expect, test } from "bun:test"
import { Provider } from "./provider"

describe("Provider.sort", () => {
  test("returns same array when empty", () => {
    const sorted = Provider.sort([])
    expect(sorted).toEqual([])
  })

  test("returns same array with single element", () => {
    const models = [{ id: "gpt-5", providerID: "openai" }] as Provider.Model[]
    const sorted = Provider.sort(models)
    expect(sorted.length).toBe(1)
    expect(sorted[0].id).toBe("gpt-5")
  })

  test("includes all models in output", () => {
    const models = [
      { id: "model-a", providerID: "test" },
      { id: "model-b", providerID: "test" },
      { id: "model-c", providerID: "test" },
    ] as Provider.Model[]

    const sorted = Provider.sort(models)
    expect(sorted.length).toBe(3)
    const sortedIds = sorted.map((m) => m.id)
    expect(sortedIds).toContain("model-a")
    expect(sortedIds).toContain("model-b")
    expect(sortedIds).toContain("model-c")
  })

  test("sorts by id as final tiebreaker", () => {
    const models = [
      { id: "aaa", providerID: "test" },
      { id: "bbb", providerID: "test" },
      { id: "ccc", providerID: "test" },
    ] as Provider.Model[]

    const sorted = Provider.sort(models)
    // With desc on id, ccc should be first
    expect(sorted[0].id).toBe("ccc")
    expect(sorted[2].id).toBe("aaa")
  })
})
