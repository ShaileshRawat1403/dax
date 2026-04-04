import { describe, expect, test } from "bun:test"

describe("Agent module structure", () => {
  test("Agent namespace exports required functions", async () => {
    const { Agent } = await import("./agent")

    expect(typeof Agent.get).toBe("function")
    expect(typeof Agent.list).toBe("function")
    expect(typeof Agent.defaultAgent).toBe("function")
    expect(typeof Agent.generate).toBe("function")
  })
})
