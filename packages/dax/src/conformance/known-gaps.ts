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
  "integrity.contract-immutability-cross-store-race":
    "Contract mutability authorization and contract replacement are not one atomic cross-store operation; no production caller currently races a changed rewrite with event-authority establishment",
  "integrity.event-authority-partial-initialization-recovery":
    "If the event-log authority marker is persisted but contract_compiled cannot be appended, the contract correctly remains locked but recovery cannot retry or repair the zero-event authority state",
  "integrity.gateway-projection-authority":
    "The compatibility run event stream still changes production snapshot fields for event-authority runs, so it is not projection-only",
  "inv1.record-classes":
    "Prompt, context, assistant message, delegation and compaction replacement have no durable event representation (6 of 11 classes covered)",
  "inv3.conformance-points": "Execution paths do not emit the same conformance points (16 of 40)",
  "inv3.governance-spread": "An action's governance still depends on which execution path it entered through",
  "inv5.capability-vocabulary": "No capability registry exists; capabilities are still separate architectural categories",
  "inv5.capability-properties": "Capabilities do not declare intrinsic properties distinct from contract authority",
  "inv5.contract-grants": "Contracts do not express authority as grants against named capabilities",
  "scope.journal-primitive": "The journal machinery (append, sequence validation, locking, envelope validation, replay) is not generic over scope, so a second scope would copy it rather than instantiate it",
  "scope.aware-envelope": "The event envelope carries runId only, so an event cannot state which scope owns it or cite provenance across scopes",
  "scope.project-journal": "No project-scoped journal exists, so facts that outlive their run — promoted memory, project conventions — have no authoritative owner",
  "producer.reachability-approximated": "Producer detection pattern-matches non-test call sites rather than proving reachability from a production entry point, so a dead helper calling the producer would pass",
  "memory.no-producer": "Project memory is read by intent interpretation on every session but no production code writes it; what may be promoted into memory is an open governance decision",
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
