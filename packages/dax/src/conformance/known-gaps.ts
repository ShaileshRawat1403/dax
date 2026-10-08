/**
 * Sprint ledger. Empty records completion of the documented scope,
 * not absence of every defect or support for every executable binding form.
 * See
 * docs/tooling/conformance-final-acceptance.md for the scope and producer matrix.
 */
export const KNOWN_GAPS = Object.freeze({} as const)
export type GapId = keyof typeof KNOWN_GAPS

/** Isolated ledgers let the red-on-closure mechanism stay tested when none remain. */
export function createGapChecks<const G extends Record<string, string>>(ledger: G) {
  type Id = Extract<keyof G, string>
  const requireGap = (id: Id) => {
    if (!Object.hasOwn(ledger, id))
      throw new Error(`Unknown gap id "${id}". Add it to KNOWN_GAPS with a description of what is missing.`)
  }
  const closed = (id: Id) =>
    new Error(
      `Gap "${id}" appears to be CLOSED — its conformance check now passes.\n` +
        `${ledger[id]}\nDelete the entry from KNOWN_GAPS and unwrap its check; leaving it wrapped hides the fix.`,
    )
  function expectGap(id: Id, check: () => void): void {
    requireGap(id)
    let stillOpen = false
    try {
      check()
    } catch {
      stillOpen = true
    }
    if (!stillOpen) throw closed(id)
  }
  async function expectAsyncGap(id: Id, check: () => Promise<void>): Promise<void> {
    requireGap(id)
    let stillOpen = false
    try {
      await check()
    } catch {
      stillOpen = true
    }
    if (!stillOpen) throw closed(id)
  }
  return Object.freeze({ expectGap, expectAsyncGap })
}

export const { expectGap, expectAsyncGap } = createGapChecks(KNOWN_GAPS)
