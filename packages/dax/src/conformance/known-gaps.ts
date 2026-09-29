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
 * Property 3 exists because an earlier execution meter stayed green while its
 * source-text approximation and obsolete workflow denominator hid what production
 * could actually prove. An unnoticed fix is a measurement problem, not good news.
 *
 * To close a gap: delete its entry here and unwrap its check. The test should
 * then pass on its own terms.
 */

export const KNOWN_GAPS = {
  "inv5.capability-vocabulary":
    "Native, loader-backed plugin and DAX-adapted MCP model tools are enrolled; legacy custom registration, graph/workflow, worker, command and context executors remain outside the descriptive registry",
  "inv5.capability-properties":
    "Native, loader-backed plugin and DAX-adapted MCP descriptors are validated and descriptive; legacy custom, graph/workflow, worker and context executors lack validated intrinsic descriptors",
  "inv5.contract-grants": "Contracts do not express authority as grants against named capabilities",
  "scope.journal-primitive":
    "The run journal uses shared append, locking, sequence, validation, and replay machinery, but no production project journal instantiates that machinery yet",
  "scope.aware-envelope":
    "The parser accepts v2 owner and source references while preserving v1 history, but production run events remain v1 and no project-owned producer proves cross-scope provenance",
  "scope.project-journal":
    "No project-scoped journal exists, so facts that outlive their run — promoted memory, project conventions — have no authoritative owner",
  "memory.no-producer":
    "Project memory is read by intent interpretation on every session but no production code writes it; what may be promoted into memory is an open governance decision",
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

/** Async counterpart for production-path checks that cross a storage boundary. */
export async function expectAsyncGap(id: GapId, check: () => Promise<void>): Promise<void> {
  if (!(id in KNOWN_GAPS)) {
    throw new Error(`Unknown gap id "${id}". Add it to KNOWN_GAPS with a description of what is missing.`)
  }
  let stillOpen = false
  try {
    await check()
  } catch {
    stillOpen = true
  }
  if (!stillOpen) {
    throw new Error(
      `Gap "${id}" appears to be CLOSED — its production conformance check now passes.\n` +
        `${KNOWN_GAPS[id]}\n` +
        "Delete the ledger entry and run this behavior test normally once independently reviewed.",
    )
  }
}
