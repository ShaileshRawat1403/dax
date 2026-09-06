import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { STREAM_INDENT } from "./layout"
import { STATUS_GLYPH } from "@/dax/presentation/status-glyph"

/**
 * The stream's visual contract.
 *
 * Nothing in CI renders a component, which is why a one-column misalignment, a
 * separator drawn at 1.03:1 and body text at 2.2:1 all shipped. Until a real
 * render harness exists, these assert the properties directly on the source:
 * they are cheap, they have no runtime, and they fail on exactly the changes
 * that caused the defects.
 */
const dir = import.meta.dir
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, readFileSync(path.join(dir, f), "utf8")] as const)

describe("stream visual contract", () => {
  test("no stream component dims text", () => {
    // textMuted with DIM measures 2.2:1 against the default theme, below even
    // the large-text floor. Anything that needs to recede further than
    // textMuted should not be printed.
    const offenders = sources.filter(([, src]) => src.includes("TextAttributes.DIM")).map(([f]) => f)
    expect(offenders).toEqual([])
  })

  test("no stream component hardcodes its indent", () => {
    const offenders = sources
      .filter(([f]) => f !== "layout.ts")
      .filter(([, src]) => /padding(Left|Right)=\{[1-9]/.test(src))
      .map(([f]) => f)
    expect(offenders).toEqual([])
  })

  test("indent is a two-step scale, and structure is not deeper than content", () => {
    expect(STREAM_INDENT.structure).toBeLessThanOrEqual(STREAM_INDENT.content)
  })

  test("no stream component invents its own status glyph", () => {
    // A middot between two pieces of metadata ("3 steps · 12s") is punctuation.
    // A bare glyph alone in a text node is a status mark, and those come from
    // STATUS_GLYPH so that one state cannot acquire two symbols.
    const known = new Set(Object.values(STATUS_GLYPH))
    const strays = new Set<string>()
    for (const [, src] of sources) {
      for (const match of src.match(/>\s*([·•●○×✔✘⟳])\s*<|"([·•●○×✔✘⟳])"/gu) ?? []) {
        const glyph = match.replace(/[>"<\s]/g, "")
        if (!known.has(glyph)) strays.add(glyph)
      }
    }
    expect([...strays]).toEqual([])
  })

  test("no stream component formats a duration itself", () => {
    // Two formatters were live at once and disagreed: 1m 5s against 1m 05s.
    const offenders = sources.filter(([, src]) => /Math\.floor\(\s*s\s*\/\s*60\s*\)|`\$\{ms\}ms`/.test(src)).map(([f]) => f)
    expect(offenders).toEqual([])
  })

  test("the turn separator actually draws a rule", () => {
    const item = sources.find(([f]) => f === "stream-item.tsx")![1]
    const separator = item.slice(item.indexOf("function TurnSeparator"))
    expect(separator).toContain("border=")
  })
})
