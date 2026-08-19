/**
 * The gaps this codebase has not closed yet, recorded explicitly.
 *
 * The conformance suite is written against the architecture DAX is meant to have,
 * so some of it necessarily fails against the architecture DAX currently has.
 * Left as ordinary failing tests, that turns CI permanently red — and a
 * permanently-red suite is worse than no suite, because within a fortnight red
 * reads as normal and a real regression goes unnoticed.
 *
 * So each open gap is recorded here and its check is wrapped in `expectGap`,
 * which inverts the assertion: the check must still fail. That gives three
 * properties, and the third is the one worth having.
 *
 *   1. CI is green while the gap is open.
 *   2. A *new* failure — an invariant that used to hold and stopped — is an
 *      ordinary red test, because it is not wrapped.
 *   3. A gap that *closes* also turns red, until it is struck from this list.
 *
 * Property 3 exists because the execution meter sat at 10/24 through an entire
 * workstream that was supposed to move it, and nobody noticed the instrument was
 * measuring three of five paths. An unnoticed fix is a measurement problem, not
 * good news.
 *
 * To close a gap: delete its entry here and unwrap its check. The test should
 * then pass on its own terms.
 */

export const KNOWN_GAPS = {
  "inv1.record-classes": "Prompt, context, message, tool call, tool result, policy, delegation and compaction have no durable event representation (3 of 11 classes covered)",
  "inv3.conformance-points": "Execution paths do not emit the same conformance points (14 of 40)",
  "inv3.governance-spread": "An action's governance still depends on which execution path it entered through",
  "inv4.tool-output-validation": "Tool results are a TypeScript shape, never parsed at runtime; needs the H2 output-contract decision first",
  "inv4.payload-schemas": "Event payloads are typed at compile time but not parsed per type at runtime",
  "inv5.capability-vocabulary": "No capability registry exists; capabilities are still separate architectural categories",
  "inv5.capability-properties": "Capabilities do not declare intrinsic properties distinct from contract authority",
  "inv5.contract-grants": "Contracts do not express authority as grants against named capabilities",
  "inv5.grant-resolution": "Execution paths do not resolve authority through one shared grant lookup",
} as const

export type GapId = keyof typeof KNOWN_GAPS

/**
 * Assert that a known gap is still open.
 *
 * `check` contains the assertions the invariant would satisfy if it held. While
 * the gap is open those assertions fail, and that is the expected outcome. When
 * they start passing, this throws — the gap has closed and the ledger is stale.
 */
export function expectGap(id: GapId, check: () => void): void {
  if (!(id in KNOWN_GAPS)) {
    throw new Error(`Unknown gap id "${id}". Add it to KNOWN_GAPS with a description of what is missing.`)
  }

  let stillOpen = false
  try {
    check()
  } catch {
    stillOpen = true
  }

  if (!stillOpen) {
    throw new Error(
      `Gap "${id}" appears to be CLOSED — its conformance check now passes.\n` +
        `  ${KNOWN_GAPS[id]}\n` +
        `If that is intended, delete the entry from KNOWN_GAPS and unwrap the check so it ` +
        `asserts on its own terms. Leaving it wrapped hides the fix from the next reader.`,
    )
  }
}
