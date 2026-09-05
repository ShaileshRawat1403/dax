import { describe, expect, test } from "bun:test"
import { DECISION_GLYPH, STATUS_GLYPH, STATUS_TONE, decisionGlyph, statusGlyph } from "./status-glyph"

describe("status vocabulary", () => {
  test("every state has exactly one glyph, and no glyph is reused", () => {
    const glyphs = Object.values(STATUS_GLYPH)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  test("every state has a tone", () => {
    for (const state of Object.keys(STATUS_GLYPH)) {
      expect(STATUS_TONE[state as keyof typeof STATUS_TONE]).toBeDefined()
    }
  })

  test("an unknown status falls back to pending rather than rendering nothing", () => {
    expect(statusGlyph(undefined)).toBe(STATUS_GLYPH.pending)
  })

  test("approval outcomes reuse the status marks where they mean the same thing", () => {
    expect(DECISION_GLYPH.approve).toBe(STATUS_GLYPH.completed)
    expect(DECISION_GLYPH.deny).toBe(STATUS_GLYPH.failed)
  })

  test("an unknown decision resolves to a defined glyph", () => {
    expect(decisionGlyph("something-new")).toBe(DECISION_GLYPH.resolved)
    expect(decisionGlyph(undefined)).toBe(DECISION_GLYPH.resolved)
  })
})
