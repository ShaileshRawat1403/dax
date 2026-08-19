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
    // The question an audited approval has to answer is not "did someone approve"
    // but "what were they shown, and what did they permit". Until the title,
    // reason and expectedConsequence rode on the event, they lived only in the
    // ApprovalStore — which made the store authoritative and the log decorative.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "approval_requested",
        payload: {
          approvalId: "apr_1",
          approvalType: "patch_apply",
          risk: "medium",
          title: "Approve governed codex changes",
          reason: "External worker produced a kernel-computed diff requiring human approval.",
          expectedConsequence: "The reviewed patch becomes an approved artifact.",
          stepId: "step_1",
        },
      },
    )

    const projected = reduceRunState(events)
    const approval = projected?.approvals.find((a) => a.approvalId === "apr_1")

    expect(projected?.pendingApprovalIds).toEqual(["apr_1"])
    expect(approval).toMatchObject({
      approvalType: "patch_apply",
      risk: "medium",
      title: "Approve governed codex changes",
      reason: "External worker produced a kernel-computed diff requiring human approval.",
      expectedConsequence: "The reviewed patch becomes an approved artifact.",
      status: "pending",
    })
  })

  test("who decided, and when, survives replay", () => {
    // An unattributed decision is not an audit record. The resolution event now
    // carries the actor, so replay can answer "on whose authority" without
    // consulting a sibling store.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "approval_requested",
        payload: { approvalId: "apr_1", approvalType: "patch_apply", risk: "high", title: "Apply patch" },
      },
      {
        type: "approval_resolved",
        payload: {
          approvalId: "apr_1",
          decision: "approved",
          actor: "operator@example.com",
          resolvedAt: "2026-08-19T12:00:00.000Z",
        },
      },
    )

    const approval = reduceRunState(events)?.approvals.find((a) => a.approvalId === "apr_1")

    expect(approval).toMatchObject({
      status: "approved",
      decidedBy: "operator@example.com",
      decidedAt: "2026-08-19T12:00:00.000Z",
    })
  })

  test("an approval recorded before the log carried its text still replays", () => {
    // Backward compatibility is load-bearing here: real logs exist with the old
    // three-field payload, and refusing them would trade one broken invariant for
    // another.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "approval_requested", payload: { approvalId: "apr_old", approvalType: "tool", risk: "medium" } },
    )

    const approval = reduceRunState(events)?.approvals.find((a) => a.approvalId === "apr_old")

    expect(approval).toMatchObject({ approvalType: "tool", risk: "medium", title: null, reason: null })
  })

  test("worker evidence is reproducible, not merely recorded", () => {
    // H1a gave contract_refined, worker_sandbox_recorded and worker_egress_denied
    // explicit reducer cases to close the vocabulary, but they were deliberate
    // no-ops — so a run whose worker attempted a blocked host was, after replay,
    // indistinguishable from one that did not.
    const events = log(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      {
        type: "contract_refined",
        payload: {
          writeScope: ["src/**"],
          forbiddenPaths: [".env"],
          verification: ["bun test"],
          provenance: { writeScope: "operator-reviewed" },
        },
      },
      {
        type: "worker_sandbox_recorded",
        payload: {
          provider: "seatbelt",
          providerId: "codex",
          filesystem: "checkout-write-only",
          network: "localhost-only",
          egress: "filtered",
          egressAllowHosts: ["api.anthropic.com"],
        },
      },
      {
        type: "worker_egress_denied",
        payload: { providerId: "codex", hosts: ["exfil.example.com"] },
      },
    )

    const evidence = reduceRunState(events)?.evidence

    // What scope was granted, how it was isolated, what it tried to reach.
    expect(evidence?.contract).toMatchObject({ writeScope: ["src/**"], forbiddenPaths: [".env"] })
    expect(evidence?.sandbox).toMatchObject({ provider: "seatbelt", network: "localhost-only" })
    expect(evidence?.egressDenials).toEqual([{ providerId: "codex", hosts: ["exfil.example.com"] }])
  })

  test("an out-of-order log is refused rather than projected", () => {
    // Contiguity is what makes replay equivalence meaningful. A log with a gap
    // reconstructs a state that never existed.
    const events = log({ type: "execution_queued", payload: {} })
    events.push(createEvent(RUN_ID, 7, "workflow_started", {}))

    expect(() => reduceRunState(events)).toThrow(/seq|contiguous|order/i)
  })
})
