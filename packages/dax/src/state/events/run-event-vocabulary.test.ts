import { describe, expect, test } from "bun:test"
import { createEvent, type RunEventEnvelope, type RunEventType } from "./run-event-types"
import { reduceRunState } from "./run-reducer"

/**
 * H1a acceptance tests: the run event vocabulary is closed.
 *
 * The baseline finding (docs/architecture/HARNESS_COMPARATIVE_BASELINE.md, T2/T6)
 * is that DAX writes event types outside the RunEventType union via an `as any`
 * cast, and that the reducer silently ignores any type it has no case for. Both
 * make the durable log lossy in a way nothing detects: an event is appended,
 * projects nowhere, and no read path complains.
 *
 * These tests describe the closed vocabulary. They are written against the
 * behavior we want, not the behavior we have.
 */

const RUN_ID = "run_vocab_test"

function seed(): RunEventEnvelope[] {
  return [createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_test" })]
}

function withEvents(...events: Array<{ type: RunEventType; payload: unknown }>): RunEventEnvelope[] {
  const log = seed()
  events.forEach((e, i) => log.push(createEvent(RUN_ID, i + 1, e.type, e.payload)))
  return log
}

describe("closed run event vocabulary", () => {
  test("every type the worker run emits is a member of RunEventType", () => {
    // These four are appended by packages/dax/src/workflows/worker-run.ts.
    // `contract_refined` (:304) and `worker_egress_denied` (:349) reach the
    // store only through the `eventType as any` cast in event-transitions.ts,
    // so today they are written but unrepresentable.
    const emitted: RunEventType[] = [
      "contract_refined",
      "worker_sandbox_recorded",
      "worker_egress_denied",
      "verification_recorded",
    ]

    // The assertion that matters here is the type annotation above: if any of
    // these is absent from RunEventType, this file does not compile. The
    // runtime check keeps the test honest if the array is ever emptied.
    expect(emitted).toHaveLength(4)
  })

  test("worker_sandbox_recorded carries the egress fields the worker actually writes", () => {
    // worker-run.ts:332-346 writes egress, egressEnforcement and
    // egressAllowHosts. The union declares none of them, so the recorded
    // isolation posture is wider than its own type.
    const log = withEvents({
      type: "worker_sandbox_recorded",
      payload: {
        provider: "seatbelt",
        providerId: "codex",
        filesystem: "checkout-write-only",
        network: "localhost-only",
        reapedDescendants: false,
        egress: "filtered",
        egressEnforcement: "cooperative-proxy",
        egressAllowHosts: ["api.anthropic.com"],
      },
    })

    expect(() => reduceRunState(log)).not.toThrow()
  })

  test("contract_refined projects without falling through the reducer", () => {
    const log = withEvents({
      type: "contract_refined",
      payload: {
        writeScope: ["packages/dax/**"],
        forbiddenPaths: [".env"],
        verification: ["bun run typecheck"],
        provenance: {
          writeScope: "operator-reviewed",
          forbiddenPaths: "operator-reviewed",
          verification: "operator-reviewed",
        },
      },
    })

    expect(() => reduceRunState(log)).not.toThrow()
  })

  test("worker_egress_denied projects without falling through the reducer", () => {
    const log = withEvents({
      type: "worker_egress_denied",
      payload: { providerId: "codex", hosts: ["evil.example.com"] },
    })

    expect(() => reduceRunState(log)).not.toThrow()
  })

  test("an unknown event type is refused, not silently ignored", () => {
    // T6. The reducer's switch has no default case, so a log written by a
    // newer build (or a corrupted one) projects partial state and reports
    // success. DeepSeek's coordinator refuses such a log outright
    // (coordinator.ts:1061-1067); DAX should refuse it here.
    const log = seed()
    log.push({
      ...createEvent(RUN_ID, 1, "run_completed", {}),
      type: "definitely_not_a_real_event" as RunEventType,
    })

    expect(() => reduceRunState(log)).toThrow(/unknown event type/i)
  })

  test("the refusal names the offending type and seq so the log can be located", () => {
    const log = seed()
    log.push({
      ...createEvent(RUN_ID, 1, "run_completed", {}),
      type: "some_future_event" as RunEventType,
    })

    expect(() => reduceRunState(log)).toThrow(/some_future_event/)
    expect(() => reduceRunState(log)).toThrow(/1/)
  })

  test("a known-type log still projects to a terminal state", () => {
    // Guard against closing the vocabulary by breaking the happy path.
    const log = withEvents(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "run_completed", payload: {} },
    )

    const state = reduceRunState(log)
    expect(state?.status).toBe("completed")
  })
})
