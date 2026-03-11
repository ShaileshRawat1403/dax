import { describe, expect, it } from "bun:test"
import { isTransientLockedError, withLockedRetry } from "./locked-retry"

describe("withLockedRetry", () => {
  it("retries transient lock errors and succeeds", async () => {
    let attempts = 0
    const result = await withLockedRetry(async () => {
      attempts++
      if (attempts < 3) throw new Error("database is locked")
      return "ok"
    })

    expect(result).toBe("ok")
    expect(attempts).toBe(3)
  })

  it("does not retry unrelated errors", async () => {
    let attempts = 0
    await expect(
      withLockedRetry(async () => {
        attempts++
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    expect(attempts).toBe(1)
  })
})

describe("isTransientLockedError", () => {
  it("detects database lock errors", () => {
    expect(isTransientLockedError(new Error("database is locked"))).toBe(true)
    expect(isTransientLockedError(new Error("DATABASE IS LOCKED"))).toBe(true)
    expect(isTransientLockedError(new Error("boom"))).toBe(false)
    expect(isTransientLockedError("database is locked")).toBe(false)
  })
})
