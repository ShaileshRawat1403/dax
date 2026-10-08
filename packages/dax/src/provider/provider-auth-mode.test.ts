import { describe, expect, test } from "bun:test"
import { Provider } from "./provider"

describe("direct provider credential modes", () => {
  test("does not expose an AGY-owned session as a direct model credential", () => {
    expect(
      Provider.supportsDirectModelAccess({
        type: "oauth",
        access: "agy-owned",
        refresh: "agy-owned",
        expires: Date.now() + 60_000,
        mode: "antigravity-import",
      }),
    ).toBe(false)
  })

  test("preserves supported direct provider credentials", () => {
    expect(Provider.supportsDirectModelAccess({ type: "api", key: "test-key" })).toBe(true)
    expect(
      Provider.supportsDirectModelAccess({
        type: "oauth",
        access: "direct",
        refresh: "direct",
        expires: Date.now() + 60_000,
        mode: "codeassist",
      }),
    ).toBe(true)
  })
})


test("retired Claude OAuth is unavailable for both native provider IDs", () => {
  const oauth = { type: "oauth" as const, access: "retired", refresh: "retired", expires: Date.now() + 60_000 }
  for (const provider of ["anthropic", "claude-code"]) {
    expect(Provider.supportsDirectModelAccess(oauth, provider)).toBe(false)
    expect(Provider.supportsDirectModelAccess({ type: "api", key: "fixture" }, provider)).toBe(true)
  }
  expect(Provider.supportsDirectModelAccess(oauth, "openai")).toBe(true)
})
