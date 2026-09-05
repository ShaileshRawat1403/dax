import { describe, expect, test } from "bun:test"
import { extractAuth, validateAuth } from "./fastmcp-substrate"

describe("substrate authentication", () => {
  test("requires a configured credential", () => {
    expect(validateAuth(undefined, undefined)).toBe(false)
    expect(validateAuth({ mode: "token", token: "anything" }, undefined)).toBe(false)
    expect(validateAuth(undefined, "secret")).toBe(false)
  })

  test("accepts only the exact bearer token, including UTF-8 byte length", () => {
    expect(validateAuth({ mode: "token", token: "secret" }, "secret")).toBe(true)
    for (const token of ["", "wrong!", "short", "longer token", "sécret"]) {
      expect(validateAuth({ mode: "token", token }, "secret")).toBe(false)
    }
    expect(validateAuth({ mode: "token", token: "é" }, "é")).toBe(true)
  })

  test("rejects unsupported authorization schemes", async () => {
    // Assemble the former bypass scheme so repository searches can prove it is gone.
    const scheme = ["dev", "unsafe"].join("-")
    for (const authorization of [`${scheme} ${scheme}`, "Basic secret", "Bearer"]) {
      const auth = await extractAuth(new Request("http://localhost", { headers: { authorization } }))
      expect(auth).toBeUndefined()
      expect(validateAuth(auth, "secret")).toBe(false)
    }
  })
})
