import { describe, expect, test } from "bun:test"
import { formatPMList, formatPMRules, parsePMList, parsePMRules } from "./format"

describe("PM format contracts", () => {
  test("list format and parse roundtrip", () => {
    const text = formatPMList([
      { day: "2026-03-05", title: "Release prep", tags: ["release", "qa"] },
      { day: "2026-03-04", title: "Auth hardening", tags: [] },
    ])
    const parsed = parsePMList(text)
    expect(parsed.info).toBeUndefined()
    expect(parsed.rows).toEqual([
      { day: "2026-03-05", title: "Release prep", tags: ["release", "qa"] },
      { day: "2026-03-04", title: "Auth hardening", tags: [] },
    ])
  })

  test("rules format and parse roundtrip", () => {
    const text = formatPMRules([
      { ruleType: "require_approval", pattern: "release:publish", action: "ask", source: "user" },
      { ruleType: "deny_tool", pattern: "bash:rm -rf *", action: "deny", source: "default" },
    ])
    const parsed = parsePMRules(text)
    expect(parsed.info).toBeUndefined()
    expect(parsed.rows).toEqual([
      { ruleType: "require_approval", pattern: "release:publish", action: "ask", source: "user" },
      { ruleType: "deny_tool", pattern: "bash:rm -rf *", action: "deny", source: "default" },
    ])
  })

  test("empty and usage responses are treated as informational", () => {
    expect(parsePMList("No DSR notes found.")).toEqual({
      rows: [],
      info: "No DSR notes found.",
    })
    expect(
      parsePMRules("Usage: /pm rules add <never_touch|require_approval|deny_tool|allow_tool> <pattern> <allow|deny|ask>"),
    ).toEqual({
      rows: [],
      info: "Usage: /pm rules add <never_touch|require_approval|deny_tool|allow_tool> <pattern> <allow|deny|ask>",
    })
  })
})
