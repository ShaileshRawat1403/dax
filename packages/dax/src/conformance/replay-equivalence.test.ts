import { describe, expect, test } from "bun:test"
import { createEvent, type RunEventEnvelope, type RunEventType } from "@/state/events/run-event-types"
import { reduceRunState } from "@/state/events/run-reducer"

/**
 * Invariant 2 — Replay Equivalence.
 *
 * Authoritative runtime state must be reproducible from durable event history.
 *
 *     live execution final state  ==  state reconstructed from durable events
 *
 * Not just run status. Approval state, evidence, verification, authority
 * transitions, completion status, and eventually session-visible context.
 *
 * Decision procedure: can this state be rebuilt from the log alone, with no access
 * to any sibling store?
 *
 * This is the highest-yield invariant in the set. A single equivalence check
 * catches a large class of architectural drift, because every parallel store
 * eventually shows up as a field the log cannot reproduce.
 */

const RUN_ID = "run_replay_test"

function log(...events: Array<{ type: RunEventType; payload: unknown }>): RunEventEnvelope[] {
  const out = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_test" })]
  events.forEach((e, i) => out.push(createEvent(RUN_ID, i + 1, e.type, e.payload)))
  return out
}

describe("invariant 2 — replay equivalence", () => {
  test("projection is deterministic: the same log yields the same state", () => {
    // The floor. Holds at v1.3.0 and must keep holding.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "step_added", payload: { stepId: "s1", title: "Do thing", stepType: "executed" } },
      { type: "step_started", payload: { stepId: "s1" } },
      { type: "step_completed", payload: { stepId: "s1", outputs: ["out"] } },
    )

    const a = reduceRunState(events)
    const b = reduceRunState(events)

    expect(a).toEqual(b)
  })

  test("pending approval set is reproducible from the log", () => {
    // Holds: approval_requested / approval_resolved move pendingApprovalIds.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "approval_requested", payload: { approvalId: "apr_1", approvalType: "tool", risk: "medium" } },
    )

    expect(reduceRunState(events)?.pendingApprovalIds).toEqual(["apr_1"])

    const resolved = [
      ...events,
      createEvent(RUN_ID, events.length, "approval_resolved", { approvalId: "apr_1", decision: "approved" }),
    ]

    expect(reduceRunState(resolved)?.pendingApprovalIds).toEqual([])
  })

  test("the approval a reviewer saw is reproducible from the log", () => {
    // Fails at v1.3.0. The event carries an id, a type and a risk band. The
    // title, reason and expectedConsequence — the text the operator actually read
    // before deciding — live only in the ApprovalStore.
    //
    // Replay can therefore reproduce that an approval was granted, but not what
    // was approved. That is the ApprovalStore divergence, stated as a test.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "approval_requested",
        payload: { approvalId: "apr_1", approvalType: "patch_apply", risk: "medium" },
      },
    )

    const projected = reduceRunState(events)
    const approvalEvent = events.find((e) => e.type === "approval_requested")
    const payload = approvalEvent?.payload as Record<string, unknown>

    expect(projected?.pendingApprovalIds).toEqual(["apr_1"])
    expect(Object.keys(payload).sort()).toEqual(
      ["approvalId", "approvalType", "expectedConsequence", "reason", "risk", "title"].sort(),
    )
  })

  test("worker evidence is reproducible, not merely recorded", () => {
    // Fails at v1.3.0. H1a gave contract_refined, worker_sandbox_recorded and
    // worker_egress_denied explicit reducer cases — but they are deliberate no-ops,
    // so the events append and project nowhere.
    //
    // A run whose worker attempted to reach a blocked host is indistinguishable,
    // after replay, from one that did not. That is exactly the record a reviewer
    // needs.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "worker_egress_denied",
        payload: { providerId: "codex", hosts: ["exfil.example.com"] },
      },
    )

    const state = reduceRunState(events) as unknown as { evidence?: unknown }

    expect(state.evidence).toBeDefined()
  })

  test("an out-of-order log is refused rather than projected", () => {
    // Contiguity is what makes replay equivalence meaningful. A log with a gap
    // reconstructs a state that never existed.
    const events = log({ type: "execution_queued", payload: {} })
    events.push(createEvent(RUN_ID, 7, "workflow_started", {}))

    expect(() => reduceRunState(events)).toThrow(/seq|contiguous|order/i)
  })
})
