import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { expectGap } from "./known-gaps"

/**
 * A live consumer must have a live producer.
 *
 * Three instances of one bug were found in a single working session, and none of
 * them failed a test, raised a warning, or looked wrong in review:
 *
 *   - `rao/adapters.ts` built the operator-facing claim "Mutations recorded (N)"
 *     from `mutationReceiptIds`, which no event populated. The ledger reported no
 *     mutations for runs that had mutated.
 *   - Completion proof read `governance.touchedFiles`, which no event populated,
 *     so it evaluated every run against an empty change set.
 *   - `interpretIntent` reads project memory on the first message of every
 *     session. Nothing has ever written project memory.
 *
 * Each degrades silently, because an empty result and "nothing to report" are
 * indistinguishable to the caller. That is what makes this class of defect
 * survive: it never produces an error, only a quietly weaker answer.
 *
 * So the pairing is asserted directly. The invariant is:
 *
 *   **An authoritative consumer must have a production-reachable producer path.**
 *
 *       production entry point → producer → authoritative state → consumer
 *
 * Tests, dead helpers, fixtures, migrations and unused exports do not satisfy it.
 * A test caller proves the API is executable, not that anything executes it —
 * which is exactly how all three defects above looked healthy.
 *
 * The checks below approximate that property by pattern-matching producer call
 * sites in non-test source. That is weaker than the invariant: a helper outside a
 * test file which is itself unreachable from any entry point would pass. The
 * approximation is recorded as `producer.reachability-approximated` so the
 * implementation does not quietly become the definition — the property above is
 * what must hold, and a call-graph check is what would prove it.
 */

const SRC = join(import.meta.dir, "..")

type Pairing = {
  /** What reads the data, and why its emptiness matters. */
  consumer: string
  /** The symbol that must be called from production code to populate it. */
  producer: string
  /** What goes wrong when the producer is absent. */
  failureMode: string
}

const PAIRINGS: Pairing[] = [
  {
    consumer: "rao/adapters.ts — mutation evidence claim",
    producer: "createMutationReceipt",
    failureMode: "RAO reports no mutations for runs that mutated",
  },
  {
    consumer: "execution/completion-proof.ts — touched files",
    producer: "mutation_recorded",
    failureMode: "completion proof evaluates against an empty change set",
  },
  {
    consumer: "intent/interpret.ts — project memory signals",
    producer: "save_memory",
    failureMode: "intent interpretation is shaped by memory that is always empty",
  },
]

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".dax" || entry === "conformance") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

/**
 * Files matching a producer pattern, excluding tests.
 *
 * Tests are excluded deliberately: all three defects above had healthy-looking
 * test coverage of the producer and no production caller, which is exactly why
 * nobody noticed. A generic "mentions the symbol" search cannot serve here — for
 * an event type, the declaration, the reducer case and the emit site are all the
 * same string — so each pairing supplies the pattern that means *emitted*.
 */
function producerSites(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(SRC.length + 1))
}

describe("producer/consumer symmetry", () => {
  test("mutation evidence has a production producer", () => {
    expect(producerSites(/createMutationReceipt\s*\(/)).not.toEqual([])
  })

  test("touched files have a production producer", () => {
    expect(producerSites(/appendEventOnly\([^,]+,\s*"mutation_recorded"/)).not.toEqual([])
  })

  test("project memory has a production producer", () => {
    // Open. `save_memory` is called only from pm/index.test.ts, so the store the
    // intent path reads has never been written. Deliberately not fixed by wiring
    // an arbitrary writer: what may promote something into project memory is a
    // governance decision, not plumbing. See docs for the candidate/promotion model.
    expectGap("memory.no-producer", () => {
      expect(producerSites(/\bsave_memory\s*\(/)).not.toEqual([])
    })
  })

  test("the model cannot write authoritative memory directly", () => {
    // `save_memory` accepts source: "agent". Nothing calls it today, and nothing
    // should call it with that source once a writer exists: an agent-originated
    // statement silently entering durable memory becomes an architectural
    // assumption in every future session, which is exactly the authority DAX
    // exists to govern.
    //
    // Origin and authority are different questions. A candidate may originate
    // from the model; only a governed promotion may make it authoritative.
    const offenders = sourceFiles(SRC)
      .filter((file) => /save_memory\s*\(\s*\{[^}]*source:\s*"agent"/s.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length + 1))

    expect(offenders).toEqual([])
  })

  test("producer detection proves reachability, not merely existence", () => {
    // The gap between the stated invariant and its current implementation. Closing
    // it needs reachability from a production entry point — a CLI command, a
    // server route, a workflow step — rather than "appears in a non-test file".
    // Asserted against a helper module rather than this file's own text: a test
    // that greps itself for the words it contains will always find them.
    expectGap("producer.reachability-approximated", () => {
      expect(existsSync(join(import.meta.dir, "reachability.ts"))).toBe(true)
    })
  })

  test("every declared pairing states its failure mode", () => {
    // A pairing without a stated consequence becomes folklore, and the next
    // reader cannot tell whether the gap matters.
    for (const pairing of PAIRINGS) {
      expect(pairing.failureMode.length).toBeGreaterThan(20)
      expect(pairing.consumer).toContain("—")
    }
  })
})
