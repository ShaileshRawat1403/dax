import { describe, expect, test } from "bun:test"
import { isAllowedInstructionURL } from "./instruction"

describe("instruction URL allowlist matching", () => {
  test("allows all when allowlist is empty", () => {
    expect(isAllowedInstructionURL({ url: "https://example.com/rules.md", allowlist: [] })).toBe(true)
  })

  test("supports exact host and wildcard host entries", () => {
    expect(
      isAllowedInstructionURL({
        url: "https://docs.example.com/instructions.md",
        allowlist: ["*.example.com"],
      }),
    ).toBe(true)
    expect(
      isAllowedInstructionURL({
        url: "https://example.com/instructions.md",
        allowlist: ["example.com"],
      }),
    ).toBe(true)
    expect(
      isAllowedInstructionURL({
        url: "https://evil-example.com/instructions.md",
        allowlist: ["*.example.com"],
      }),
    ).toBe(false)
  })

  test("supports full URL prefix entries", () => {
    expect(
      isAllowedInstructionURL({
        url: "https://raw.githubusercontent.com/org/repo/main/AGENTS.md",
        allowlist: ["https://raw.githubusercontent.com/org/repo/"],
      }),
    ).toBe(true)
    expect(
      isAllowedInstructionURL({
        url: "https://raw.githubusercontent.com/other/repo/main/AGENTS.md",
        allowlist: ["https://raw.githubusercontent.com/org/repo/"],
      }),
    ).toBe(false)
  })
})
