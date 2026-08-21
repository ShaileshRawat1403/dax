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

  test("every canonical event class has a runtime-valid payload contract", () => {
    const payloads: Array<
      Pick<RunEventEnvelope, "type" | "payload"> & Pick<Partial<RunEventEnvelope>, "correlationId" | "causationId">
    > = [
      { type: "contract_compiled", payload: { contractId: "ctr_1", verificationRequired: true, guardEnforcementMode: "enforce" } },
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "tool_invocation_recorded", payload: { invocationId: "inv_1", toolId: "shell", input: { basis: "validated_tool_input", canonicalization: "sorted-json-v1", digest: `sha256:${"a".repeat(64)}`, redactedPreview: '{"command":"bun test"}', truncated: false }, contractId: "ctr_1", executor: { kind: "builtin", id: "shell" }, originTurnId: "msg_1", ordinal: 0 } },
      { type: "authorization_recorded", payload: { invocationId: "inv_1", finalDisposition: "allowed", contractDisposition: "allowed", runtimeGuardDisposition: "allowed", permissionDisposition: "allowed", approvalIds: [], reasonCodes: [] }, correlationId: "inv_1" },
      { type: "tool_result_recorded", payload: { invocationId: "inv_1", status: "completed", result: { basis: "validated_dax_result_pre_truncation", canonicalization: "sorted-json-v1", digest: `sha256:${"b".repeat(64)}`, redactedPreview: '{"exit":0}', truncated: false } }, correlationId: "inv_1", causationId: "evt_authorization" },
      { type: "approval_requested", payload: { approvalId: "apr_1", approvalType: "command", risk: "high", title: "Run command", reason: "test", expectedConsequence: "changes files", stepId: null } },
      { type: "approval_resolved", payload: { approvalId: "apr_1", decision: "approved", actor: "operator", comment: "ok", resolvedAt: "2026-01-01T00:00:00.000Z" } },
      { type: "step_added", payload: { stepId: "step_1", title: "Inspect", stepType: "proposed" } },
      { type: "step_started", payload: { stepId: "step_1" } },
      { type: "step_completed", payload: { stepId: "step_1", outputs: ["artifact_1"] } },
      { type: "step_failed", payload: { stepId: "step_1", error: { code: "failed", message: "failed" } } },
      { type: "artifact_created", payload: { artifactId: "artifact_1", artifactType: "patch" } },
      { type: "draft_created", payload: { draftId: "draft_1", type: "plan", content: "content", targetPath: "PLAN.md" } },
      { type: "trust_updated", payload: { trust: { posture: "strong", score: 1, blocked: false, reasons: [] } } },
      { type: "run_failed", payload: { error: { code: "failed", message: "failed", retryable: false } } },
      { type: "run_completed", payload: { completionProof: { decision: "pass", failedChecks: [], verificationExecuted: true, receiptIds: [], artifactChecks: true, expectedOutputChecks: true, expectedOutputTypesSatisfied: [], expectedOutputTypesMissing: [], scopeChecks: true, sensitivePathApprovalChecks: true, checkedAt: "2026-01-01T00:00:00.000Z" } } },
      { type: "workflow_completed", payload: {} },
      { type: "approval_denied", payload: {} },
      { type: "approval_required", payload: {} },
      { type: "approval_resumed", payload: {} },
      { type: "provider_pressure_updated", payload: { lane: "default", throttles: 0, inFlight: 1, queueLength: 0 } },
      { type: "contract_refined", payload: { writeScope: ["src/**"], forbiddenPaths: [".env"], verification: ["bun test"], provenance: { writeScope: "operator", forbiddenPaths: "operator", verification: "operator" } } },
      { type: "worker_sandbox_recorded", payload: { provider: "seatbelt", providerId: "worker_1", filesystem: "checkout-write-only", network: "none", reapedDescendants: true, egress: "filtered", egressEnforcement: "cooperative-proxy", egressAllowHosts: [] } },
      { type: "worker_egress_denied", payload: { providerId: "worker_1", hosts: ["example.com"] } },
      { type: "mutation_recorded", payload: { receiptIds: ["receipt_1"], changedPaths: ["src/index.ts"] } },
      { type: "execution_started", payload: {} },
      { type: "plan_quality_gate", payload: { reason: "ready" } },
      { type: "signoff_requested", payload: {} },
      { type: "signoff_received", payload: { decision: "approved" } },
      { type: "workflow_signed_off", payload: {} },
      { type: "workflow_rejected", payload: {} },
      { type: "workflow_expired", payload: {} },
      { type: "workflow_failed", payload: { error: { code: "failed", message: "failed" } } },
      { type: "verification_recorded", payload: { status: "passed", receipts: [{ receiptId: "receipt_1" }], checks: [{ id: "test", kind: "test", label: "test", command: "bun test", cwd: ".", required: true, risk: "low", exitCode: 0, status: "passed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, stdoutPreview: "", stderrPreview: "" }] } },
    ]
    const events = payloads.map((event, seq) => ({
      ...createEvent(RUN_ID, seq, event.type, event.payload),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.causationId ? { causationId: event.causationId } : {}),
    }))

    expect(parseRunEventLog(RUN_ID, events)).toHaveLength(payloads.length)
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

  test("a malformed payload for a known event is refused before it can reach the reducer", () => {
    const events = [createEvent(RUN_ID, 0, "contract_compiled", { nonsense: true })]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/payload\.contractId/i)
    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/malformed/i)
  })

  test("an undeclared canonical payload field is refused instead of discarded", () => {
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", {
        contractId: "ctr_1",
        corruptExtra: true,
      }),
    ]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/corruptExtra/i)
    expect(() => reduceRunState(parseRunEventLog(RUN_ID, events))).toThrow(/corruptExtra/i)
  })

  test("an undeclared canonical envelope field is also refused", () => {
    const events = [
      {
        ...createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
        corruptEnvelopeExtra: true,
      },
    ]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/corruptEnvelopeExtra/i)
  })

  test("an undeclared field in a closed nested canonical object is refused", () => {
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
      createEvent(RUN_ID, 1, "step_failed", {
        stepId: "step_1",
        error: { code: "failed", message: "failed", corruptExtra: true },
      }),
    ]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/corruptExtra/i)
  })

  test("a payload belonging to a different event type is refused", () => {
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
      createEvent(RUN_ID, 1, "execution_queued", { contractId: "ctr_1" }),
    ]

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/payload/i)
  })

  test("historical optional payload fields remain readable", () => {
    const events = [
      createEvent(RUN_ID, 0, "contract_compiled", { contractId: "ctr_1" }),
      createEvent(RUN_ID, 1, "approval_requested", {
        approvalId: "apr_1",
        approvalType: "command",
        risk: "medium",
      }),
    ]

    expect(parseRunEventLog(RUN_ID, events)).toHaveLength(2)
  })
})
