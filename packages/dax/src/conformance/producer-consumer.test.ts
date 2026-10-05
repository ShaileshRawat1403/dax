import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { observeProjectMemory } from "./project-memory-observations"
import { observeNativeKernel, type KernelObservation } from "./execution-kernel-observations"
import { Instance } from "@/project/instance"

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
 * Mutation reachability is exercised behaviorally through the production native
 * entry point and its canonical projection. Project memory is exercised through its protected operator HTTP producer and
 * fresh production intent consumer. Only provider I/O is isolated; approval and
 * journal authority are not mocked.
 */

const testHome = mkdtempSync(join(os.tmpdir(), "dax-producer-reachability-"))
const previousTestHome = process.env.DAX_TEST_HOME
const previousGuardApprovalTimeout = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
const previousShadowAudit = process.env.DAX_DISABLE_SHADOW_AUDIT
process.env.DAX_TEST_HOME = testHome
process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "10000"
process.env.DAX_DISABLE_SHADOW_AUDIT = "1"

let memoryObservation: ReturnType<typeof observeProjectMemory> | undefined
const memory = () => memoryObservation ??= observeProjectMemory(testHome)

let nativeObservation: Promise<KernelObservation> | undefined

function observeReachableNative(): Promise<KernelObservation> {
  nativeObservation ??= observeNativeKernel(testHome)
  return nativeObservation
}

afterAll(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  if (previousGuardApprovalTimeout === undefined) delete process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
  else process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = previousGuardApprovalTimeout
  if (previousShadowAudit === undefined) delete process.env.DAX_DISABLE_SHADOW_AUDIT
  else process.env.DAX_DISABLE_SHADOW_AUDIT = previousShadowAudit
  rmSync(testHome, { recursive: true, force: true })
})

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
    producer: "project.fact.review → appendProjectEvent",
    failureMode: "intent interpretation is shaped by memory that is always empty",
  },
]

describe("producer/consumer symmetry", () => {
  test("production native dispatch reaches the mutation evidence consumer", async () => {
    const observation = await observeReachableNative()
    expect(observation.authorityConsumers?.mutationEvidenceClaim).toBe(true)
  }, 30_000)

  test("production native dispatch reaches completion scope checks with touched files", async () => {
    const observation = await observeReachableNative()
    expect(observation.authorityConsumers?.touchedFiles).toEqual(["src/native-meter.txt"])
    expect(observation.authorityConsumers?.completionScopeChecks).toBe(true)
  }, 30_000)

  test("operator HTTP promotion reaches the fresh production intent consumer", async () => {
    const observation = await memory()
    expect(observation.futureUsesApprovedFact).toBe(true)
    expect(observation.futureExcludesRetiredFact).toBe(true)
    expect(observation.providerStreams).toBe(0)
  }, 30_000)

  test("an unreviewed or mismatched candidate cannot enter authoritative memory", async () => {
    const observation = await memory()
    expect(observation.unavailableBeforeDecision).toBe(true)
    expect(observation.mismatchRejected).toBe(true)
    expect(observation.unchangedOnMismatch).toBe(true)
  }, 30_000)

  test("every declared pairing states its failure mode", () => {
    // A pairing without a stated consequence becomes folklore, and the next
    // reader cannot tell whether the gap matters.
    for (const pairing of PAIRINGS) {
      expect(pairing.failureMode.length).toBeGreaterThan(20)
      expect(pairing.consumer).toContain("—")
    }
  })
})
