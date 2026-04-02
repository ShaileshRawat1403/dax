import { afterEach, describe, expect, test } from "bun:test"
import { resolveGuardEnforcementMode, shouldBlockViolation } from "./guard-mode"

const previousGuardMode = process.env.DAX_TRUST_GUARD_MODE

afterEach(() => {
  if (previousGuardMode === undefined) delete process.env.DAX_TRUST_GUARD_MODE
  else process.env.DAX_TRUST_GUARD_MODE = previousGuardMode
})

describe("guard enforcement mode", () => {
  test("defaults to warn and normalizes unknown values to warn", () => {
    delete process.env.DAX_TRUST_GUARD_MODE
    expect(resolveGuardEnforcementMode()).toBe("warn")
    expect(resolveGuardEnforcementMode("unknown")).toBe("warn")
  })

  test("resolves enforce from explicit input and environment", () => {
    process.env.DAX_TRUST_GUARD_MODE = "enforce"
    expect(resolveGuardEnforcementMode()).toBe("enforce")
    expect(resolveGuardEnforcementMode("enforce")).toBe("enforce")
  })

  test("warn blocks only critical violations while enforce blocks high/medium too", () => {
    expect(shouldBlockViolation("warn", "critical")).toBe(true)
    expect(shouldBlockViolation("warn", "high")).toBe(false)
    expect(shouldBlockViolation("warn", "medium")).toBe(false)
    expect(shouldBlockViolation("enforce", "high")).toBe(true)
    expect(shouldBlockViolation("enforce", "medium")).toBe(true)
  })
})

