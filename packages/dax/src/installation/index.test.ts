import { describe, expect, test } from "bun:test"
import { Installation } from "./index"

describe("Installation", () => {
  test("isPreview returns boolean", () => {
    const result = Installation.isPreview()
    expect(typeof result).toBe("boolean")
  })

  test("isLocal returns boolean", () => {
    const result = Installation.isLocal()
    expect(typeof result).toBe("boolean")
  })
})
