import { describe, expect, test } from "bun:test"
import { createEvent, type RunEventEnvelope } from "./run-event-types"
import { reduceRunState } from "./run-reducer"

/**
 * A log that cannot be replayed faithfully must be refused, not projected.
 *
 * `appendRunEvent` enforces `expectedSeq` on write, so a healthy store never
 * produces a gap. Nothing enforced it on read — so a truncated, merged or
 * hand-edited events.json projected into a state that never existed, and did so
 * indistinguishably from a correct projection.
 */

const RUN_ID = "run_integrity"

function seed(): RunEventEnvelope[] {
  return [createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1", verificationRequired: false })]
}

describe("run event log integrity", () => {
  test("a contiguous log projects", () => {
    const events = seed()
    events.push(createEvent(RUN_ID, 1, "execution_queued", {}))
    events.push(createEvent(RUN_ID, 2, "workflow_started", {}))

    expect(reduceRunState(events)?.status).toBe("running")
  })

  test("a gap is refused, and the refusal says where", () => {
    // The truncation case: events 1 and 2 written, event 1 lost.
    const events = seed()
    events.push(createEvent(RUN_ID, 2, "workflow_started", {}))

    expect(() => reduceRunState(events)).toThrow(/not contiguous/i)
    expect(() => reduceRunState(events)).toThrow(/expected seq 1/)
  })

  test("a duplicated seq is refused", () => {
    // Two writers racing on a store without the lock would produce this.
    const events = seed()
    events.push(createEvent(RUN_ID, 1, "execution_queued", {}))
    events.push(createEvent(RUN_ID, 1, "workflow_started", {}))

    expect(() => reduceRunState(events)).toThrow(/not contiguous/i)
  })

  test("an out-of-order log is refused rather than silently sorted", () => {
    // Sorting here would be the dangerous fix: it would produce a plausible state
    // from a log whose order was never observed, which is precisely the thing
    // replay is supposed to rule out.
    const events = seed()
    events.push(createEvent(RUN_ID, 2, "workflow_started", {}))
    events.push(createEvent(RUN_ID, 1, "execution_queued", {}))

    expect(() => reduceRunState(events)).toThrow(/not contiguous/i)
  })

  test("a log that does not begin at seq 0 is refused", () => {
    // Head truncation. The birth record is the run's identity, so a log missing it
    // describes a run that cannot be accounted for.
    const events = [createEvent(RUN_ID, 3, "contract_compiled", { contractId: "ctr_1" })]

    expect(() => reduceRunState(events)).toThrow(/not contiguous/i)
  })

  test("a log mixing two runs is refused", () => {
    const events = seed()
    events.push(createEvent(RUN_ID, 1, "execution_queued", {}))
    events.push(createEvent("run_other", 2, "workflow_started", {}))

    expect(() => reduceRunState(events)).toThrow(/mixes runs/i)
    expect(() => reduceRunState(events)).toThrow(/run_other/)
  })

  test("an empty log is absence, not corruption", () => {
    // Distinct cases and they must stay distinct: no run yet is a normal state,
    // a broken log is not.
    expect(reduceRunState([])).toBeNull()
  })

  test("a log whose first event is not the birth record is refused", () => {
    const events = [createEvent(RUN_ID, 0, "execution_queued", {})]

    expect(() => reduceRunState(events)).toThrow(/must be contract_compiled/i)
  })
})
