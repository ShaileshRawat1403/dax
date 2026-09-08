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
