import { describe, expect, test } from "bun:test"
import { KNOWN_GAPS, expectGap, type GapId } from "./known-gaps"

/**
 * The ledger is load-bearing: it decides whether CI is green. If it silently
 * accepted everything it would be worse than deleting the conformance suite,
 * because the suite would still look like it was enforcing something.
 */

describe("known-gaps ledger", () => {
  test("an open gap passes", () => {
    // The normal case: the invariant does not hold yet, so its check throws.
    expect(() =>
      expectGap("inv5.capability-vocabulary", () => {
        throw new Error("capability registry does not exist")
      }),
    ).not.toThrow()
  })

  test("a closed gap fails, and says how to close it properly", () => {
    // The property that matters. An invariant that starts holding must turn the
    // suite red until someone strikes it from the ledger — otherwise a fix goes
    // unrecorded and the meter lies in the flattering direction.
    expect(() => expectGap("inv5.capability-vocabulary", () => {})).toThrow(/appears to be CLOSED/)
    expect(() => expectGap("inv5.capability-vocabulary", () => {})).toThrow(/KNOWN_GAPS/)
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
      expect(description.length).toBeGreaterThan(30)
      expect(id).toMatch(/^inv[1-6]\./)
    }
  })

  test("the ledger is not empty, and that is a finding rather than a comfort", () => {
    // If this ever fails because KNOWN_GAPS is empty, all six invariants hold and
    // the conformance suite should be unwrapped entirely.
    expect(Object.keys(KNOWN_GAPS).length).toBeGreaterThan(0)
  })
})
