import { describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { KNOWN_GAPS, expectGap, createGapChecks, type GapId } from "./known-gaps"

/**
 * The ledger is load-bearing: it decides whether CI is green. If it silently
 * accepted everything it would be worse than deleting the conformance suite,
 * because the suite would still look like it was enforcing something.
 */

describe("known-gaps ledger", () => {
  const fixture = createGapChecks({ "fixture.open": "Synthetic fixture; never a declared production gap." })
  test("an open gap passes", () => {
    // The normal case: the invariant does not hold yet, so its check throws.
    expect(() =>
      fixture.expectGap("fixture.open", () => {
        throw new Error("synthetic fixture invariant does not hold")
      }),
    ).not.toThrow()
  })

  test("a closed gap fails, and says how to close it properly", () => {
    // The property that matters. An invariant that starts holding must turn the
    // suite red until someone strikes it from the ledger — otherwise a fix goes
    // unrecorded and the meter lies in the flattering direction.
    expect(() => fixture.expectGap("fixture.open", () => {})).toThrow(/appears to be CLOSED/)
    expect(() => fixture.expectGap("fixture.open", () => {})).toThrow(/KNOWN_GAPS/)
  })

  test("an unrecorded gap id is refused", () => {
    // Wrapping a check under an id nobody registered would hide a failure behind
    // a typo.
    expect(() => expectGap("inv9.not-a-real-gap" as GapId, () => {})).toThrow(/Unknown gap id/)
  })

  test("every recorded gap describes what is missing", () => {
    // A ledger entry whose description is a label rather than a statement is how
    // a known gap becomes folklore.
    for (const [id, description] of Object.entries(KNOWN_GAPS)) {
      if (typeof description !== "string") throw new Error(`Gap ${id} needs a string description`)
      expect(description.length).toBeGreaterThan(30)
      // Gaps are named for the invariant they block, or for the subsystem when
      // the gap is a governance decision rather than a missing implementation.
      expect(id).toMatch(/^(inv[1-6]|[a-z]+)\./)
    }
  })

  test("empty candidate ledger refuses undeclared wrappers without claiming defect freedom", () => {
    expect(Object.isFrozen(KNOWN_GAPS)).toBe(true)
    const empty = createGapChecks({})
    expect(() => empty.expectGap("undeclared" as never, () => {})).toThrow(/Unknown gap id/)
  })

  test("async fixtures stay red on closure and refuse undeclared gaps", async () => {
    await fixture.expectAsyncGap("fixture.open", async () => {
      throw new Error("still open")
    })
    await assert.rejects(
      fixture.expectAsyncGap("fixture.open", async () => {}),
      /appears to be CLOSED/,
    )
    await assert.rejects(
      createGapChecks({}).expectAsyncGap("missing" as never, async () => {}),
      /Unknown gap id/,
    )
  })
})
