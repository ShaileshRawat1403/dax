import { describe, expect, test } from "bun:test"
import { canonicalJson } from "./evidence-export"

describe("evidence canonicalization", () => {
  // The shared schema specifies lexicographic key order. localeCompare is
  // locale-aware collation and ranks these the other way round in English, so
  // the published digest depended on the machine's locale and ICU version.
  test("orders keys by code point, not by locale collation", () => {
    const json = canonicalJson({ a: 1, B: 2, Z: 3, b: 4 })
    expect(json).toBe('{"B":2,"Z":3,"a":1,"b":4}')
    expect(Object.keys({ a: 1, B: 2 }).sort((l, r) => l.localeCompare(r))).toEqual(["a", "B"])
  })

  test("is stable regardless of the input key order", () => {
    expect(canonicalJson({ Z: 1, a: 2 })).toBe(canonicalJson({ a: 2, Z: 1 }))
  })

  test("drops undefined members and preserves array order", () => {
    expect(canonicalJson({ b: undefined, a: [3, 1, 2] })).toBe('{"a":[3,1,2]}')
  })

  test("canonicalizes nested objects", () => {
    expect(canonicalJson({ outer: { b: 1, A: 2 } })).toBe('{"outer":{"A":2,"b":1}}')
  })
})
