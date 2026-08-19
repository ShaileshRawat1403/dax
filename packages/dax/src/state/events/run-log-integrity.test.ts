import { describe, expect, test } from "bun:test"
import { createEvent, parseRunEventLog, type RunEventEnvelope } from "./run-event-types"
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

describe("run event log validation at the storage boundary", () => {
  test("a well-formed log parses", () => {
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
      createEvent(RUN_ID, 1, "execution_queued", {}),
    ]

    expect(parseRunEventLog(RUN_ID, events)).toHaveLength(2)
  })

  test("a truncated event is refused, naming its position", () => {
    // The half-written record: a crash during append leaves an object that is
    // JSON but not an event.
    const events = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }), { seq: 1 }]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/position 1/)
    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/malformed/i)
  })

  test("an event type from a newer build is refused at read", () => {
    // The forward-compatibility case. Reading it would project a partial state
    // that looks complete; refusing points the operator at the raw artifact.
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
      { ...createEvent(RUN_ID, 1, "execution_queued", {}), type: "some_future_event" },
    ]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/malformed/i)
  })

  test("a wrong schemaVersion is refused rather than assumed", () => {
    const events = [{ ...createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }), schemaVersion: "v2" }]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/malformed/i)
  })

  test("a negative or fractional seq is refused", () => {
    // seq is the log's identity. A non-integer one cannot address a position.
    const bad = [{ ...createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }), seq: -1 }]
    const fractional = [{ ...createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }), seq: 0.5 }]

    expect(() => parseRunEventLog(RUN_ID, bad)).toThrow(/malformed/i)
    expect(() => parseRunEventLog(RUN_ID, fractional)).toThrow(/malformed/i)
  })

  test("payloads pass through unparsed, and the test says so plainly", () => {
    // Envelope structure is checked; payload shape per event type is not. Asserted
    // here so the limit of the guarantee is recorded rather than assumed.
    const events = [
      { ...createEvent(RUN_ID, 0, "contract_compiled", { nonsense: true }) },
    ]

    expect(parseRunEventLog(RUN_ID, events)).toHaveLength(1)
  })
})
