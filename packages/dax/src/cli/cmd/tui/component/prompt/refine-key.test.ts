import { describe, expect, it } from "bun:test"
import { isRefineSubmitKey } from "./refine-key"

describe("isRefineSubmitKey", () => {
  it("accepts plain Enter as submit", () => {
    expect(isRefineSubmitKey({ name: "return" })).toBe(true)
  })

  it("rejects modified Enter keys so newline shortcuts still work", () => {
    expect(isRefineSubmitKey({ name: "return", shift: true })).toBe(false)
    expect(isRefineSubmitKey({ name: "return", meta: true })).toBe(false)
    expect(isRefineSubmitKey({ name: "return", ctrl: true })).toBe(false)
    expect(isRefineSubmitKey({ name: "return", super: true })).toBe(false)
  })

  it("rejects unrelated keys", () => {
    expect(isRefineSubmitKey({ name: "escape" })).toBe(false)
  })
})
