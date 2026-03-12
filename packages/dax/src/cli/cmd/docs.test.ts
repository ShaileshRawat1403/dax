import { describe, expect, test } from "bun:test"
import { normalizeDocsArgs } from "./docs"

describe("docs command arg normalization", () => {
  test("passes through args unchanged when strict is not set", () => {
    const args: { message?: string[]; strict?: boolean } = { message: ["guide", "Release Readiness"] }
    expect(normalizeDocsArgs(args)).toEqual(args)
  })

  test("appends --strict for docs qa workflows", () => {
    const args: { message?: string[]; strict?: boolean } = { message: ["qa"], strict: true }
    expect(normalizeDocsArgs(args)).toEqual({
      message: ["qa", "--strict"],
      strict: true,
    })
  })

  test("adds --strict even when no message tokens were provided", () => {
    const args: { message?: string[]; strict?: boolean } = { strict: true }
    expect(normalizeDocsArgs(args)).toEqual({
      message: ["--strict"],
      strict: true,
    })
  })
})
