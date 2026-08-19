import { describe, expect, test } from "bun:test"
import { createEvent, type RunEventEnvelope, type RunEventType } from "@/state/events/run-event-types"
import { reduceRunState } from "@/state/events/run-reducer"

/**
 * Invariant 6 — Evidence-Gated Completion.
 *
 * Execution success cannot independently imply task completion. A command that
 * exited zero is not proof that the objective was satisfied.
 *
 * Decision procedure: can this run reach `completed` without evidence that the
 * objective was satisfied?
 *
 * This is the invariant DAX should defend hardest, because it is the one no other
 * harness in the comparison set implements at all. It is also, as of v1.3.0, the
 * one with a circular gate.
 */

const RUN_ID = "run_completion_test"

function log(...events: Array<{ type: RunEventType; payload: unknown }>): RunEventEnvelope[] {
  const out = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_test" })]
  events.forEach((e, i) => out.push(createEvent(RUN_ID, i + 1, e.type, e.payload)))
  return out
}

describe("invariant 6 — evidence-gated completion", () => {
  test("a run that mutated the workspace cannot complete without verification evidence", () => {
    // The central case. This run started, produced an artifact, and completed.
    // It never verified anything.
    const mutatedButUnverified = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "artifact_created", payload: { artifactId: "art_1", artifactType: "patch" } },
      { type: "run_completed", payload: {} },
    )

    // Baseline at v1.3.0: this does NOT throw. run-reducer.ts:379 gates completion
    // on `governance.verification.required`, and `required` is set to true in
    // exactly one place — inside the `verification_recorded` case itself (:321).
    //
    // The gate is therefore circular. It constrains runs that already verified; a
    // run that never verifies is never required to. `draft-approve-execute` reaches
    // `completed` through this hole today, recording a verification *artifact* and
    // no verification *event*.
    expect(() => reduceRunState(mutatedButUnverified)).toThrow(/verification/i)
  })

  test("a failed verification blocks completion", () => {
    // This one holds at v1.3.0 and must keep holding.
    const failedVerification = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "verification_recorded",
        payload: { status: "failed", receipts: [{ receiptId: "rcp_1" }], checks: [] },
      },
      { type: "run_completed", payload: {} },
    )

    expect(() => reduceRunState(failedVerification)).toThrow(/verification/i)
  })

  test("a passed verification permits completion", () => {
    const passedVerification = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "verification_recorded",
        payload: { status: "passed", receipts: [{ receiptId: "rcp_1" }], checks: [] },
      },
      { type: "run_completed", payload: {} },
    )

    const state = reduceRunState(passedVerification)
    expect(state?.status).toBe("completed")
    expect(state?.governance.verification.satisfied).toBe(true)
  })

  test("verification requirement originates in the contract, not in its own evidence", () => {
    // The structural fix. Whether a run must verify is a property of the authority
    // it was granted — it belongs to the contract, and should be established when
    // the run is born.
    //
    // Baseline: `contract_compiled` carries only { contractId }, so the reducer has
    // no way to know a mutating run owes evidence until the evidence arrives.
    const born = log({ type: "execution_queued", payload: {} })
    const state = reduceRunState(born)

    expect(state?.governance.verification.required).toBe(true)
  })

  test("completion records what evidence satisfied it", () => {
    // A reviewer asking "why was this accepted?" should be answered by the
    // completion record itself, not by correlating it against other events.
    const completed = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "verification_recorded",
        payload: { status: "passed", receipts: [{ receiptId: "rcp_1" }], checks: [] },
      },
      { type: "run_completed", payload: {} },
    )

    const state = reduceRunState(completed)

    // Baseline: completionProof is null; the receipts live on
    // governance.verification.receiptIds and nothing binds them to the completion
    // decision.
    expect(state?.governance.completionProof).not.toBeNull()
  })
})
