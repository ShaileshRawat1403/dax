import { describe, expect, test } from "bun:test"
import { bodyHash, link, verify, canonicalJson } from "./chain"

describe("audit chain", () => {
  // These are the same vectors pinned in crates/dax-ledger/tests/chain_golden.rs.
  // Both implementations write the same format; if either drifts, one of the two
  // suites fails rather than the ledger silently becoming unverifiable.
  test("matches the Rust implementation byte for byte", () => {
    const first = link(undefined, { kind: "run.created", runId: "run_1" }, "2026-05-07T00:00:00Z")
    expect(first.bodyHash).toBe("sha256:e1ee39b445fbdad7de60a5364837cb5d681bab0870018e7f434fe3aae82fe5a8")
    expect(first.chainHash).toBe("sha256:27ef5b60643f67dd66aab4392a7305814b988443dea69e2cf604d826d0cb86a7")

    const second = link(first, { kind: "step.completed", stepId: "step_1" }, "2026-05-07T00:00:01Z")
    expect(second.chainHash).toBe("sha256:3bbe9de2263351970c54ba777350aa02e0a951de96f3477db4ac894888314d3d")
  })

  test("canonicalizes keys by byte order", () => {
    expect(canonicalJson({ z: 1, a: { b: 2, a: 1 } })).toBe('{"a":{"a":1,"b":2},"z":1}')
  })

  test("verifies an intact chain", () => {
    const bodies = [{ kind: "a" }, { kind: "b" }, { kind: "c" }]
    const chain = bodies.reduce<ReturnType<typeof link>[]>((acc, body, index) => {
      acc.push(link(acc.at(-1), body, `2026-05-07T00:00:0${index}Z`))
      return acc
    }, [])
    expect(verify(chain, bodies)).toBeUndefined()
  })

  test("detects a rewritten timestamp", () => {
    const bodies = [{ kind: "a" }, { kind: "b" }]
    const chain = [link(undefined, bodies[0], "2026-05-07T00:00:00Z")]
    chain.push(link(chain[0], bodies[1], "2026-05-07T00:00:01Z"))
    chain[1]!.ts = "2020-01-01T00:00:00Z"
    expect(verify(chain, bodies)?.reason).toContain("chainHash")
  })

  test("detects a modified body", () => {
    const bodies: unknown[] = [{ kind: "a" }]
    const chain = [link(undefined, bodies[0], "2026-05-07T00:00:00Z")]
    bodies[0] = { kind: "tampered" }
    expect(verify(chain, bodies)?.reason).toContain("modified")
  })

  test("detects a deleted entry", () => {
    const bodies = [{ kind: "a" }, { kind: "b" }, { kind: "c" }]
    const chain = bodies.reduce<ReturnType<typeof link>[]>((acc, body, index) => {
      acc.push(link(acc.at(-1), body, `2026-05-07T00:00:0${index}Z`))
      return acc
    }, [])
    expect(verify([chain[0]!, chain[2]!], [bodies[0], bodies[2]])?.reason).toContain("sequence gap")
  })

  test("bodyHash is order independent", () => {
    expect(bodyHash({ a: 1, b: 2 })).toBe(bodyHash({ b: 2, a: 1 }))
  })
})
