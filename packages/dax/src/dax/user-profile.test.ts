import { describe, expect, it } from "bun:test"
import { buildPreferredNamePrompt } from "./user-profile"

describe("user profile helpers", () => {
  it("builds a sparse preferred-name prompt", () => {
    const prompt = buildPreferredNamePrompt("Ananya")
    expect(prompt).toContain("addressed as Ananya")
    // The instruction is deliberately restrained; the name is a courtesy, not
    // a tic the model should sprinkle through every paragraph.
    expect(prompt).toContain("sparingly")
  })

  it("collapses whitespace rather than trusting the stored value", () => {
    expect(buildPreferredNamePrompt("  Ananya   Rawat ")).toContain("addressed as Ananya Rawat")
  })

  it("produces nothing when no usable name is set", () => {
    expect(buildPreferredNamePrompt(undefined)).toBeUndefined()
    expect(buildPreferredNamePrompt("")).toBeUndefined()
    expect(buildPreferredNamePrompt("   ")).toBeUndefined()
  })
})
