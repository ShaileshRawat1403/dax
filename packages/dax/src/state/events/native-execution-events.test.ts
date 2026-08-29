import { describe, expect, test } from "bun:test"
import {
  RUN_EVENT_TYPES,
  createEvent,
  parseRunEventLog,
  type RunEventEnvelope,
  type RunEventType,
} from "./run-event-types"
import { reduceRunState } from "./run-reducer"

const RUN_ID = "run_native_execution"
const CONTRACT_ID = "ctr_native_execution"
const INPUT = {
  basis: "validated_tool_input" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"a".repeat(64)}`,
  redactedPreview: '{"command":"printf [REDACTED]"}',
  truncated: false,
}
const RESULT = {
  basis: "validated_dax_result_pre_truncation" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"b".repeat(64)}`,
  redactedPreview: '{"exit":0,"output":"ok"}',
  truncated: false,
}

type EventInput = {
  type: RunEventType
  payload: unknown
  correlationId?: string
  causationId?: string
}

function event(seq: number, input: EventInput): RunEventEnvelope {
  return {
    ...createEvent(RUN_ID, seq, input.type, input.payload),
    // createEvent is a convenience constructor rather than the production
    // append path; make causation identities deterministic for semantic tests.
    eventId: `evt_test_${seq}_${input.type}`,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  }
}

function invocation(invocationId = "inv_1", extras: Record<string, unknown> = {}): EventInput {
  return {
    type: "tool_invocation_recorded",
    payload: {
      invocationId,
      toolId: "shell",
      input: INPUT,
      contractId: CONTRACT_ID,
      executor: { kind: "builtin", id: "shell" },
      originTurnId: "msg_1",
      ordinal: 0,
      ...extras,
    },
  }
}

function authorization(invocationId = "inv_1", finalDisposition: "allowed" | "denied" = "allowed"): EventInput {
  return {
    type: "authorization_recorded",
    payload: {
      invocationId,
      finalDisposition,
      contractDisposition: finalDisposition,
      runtimeGuardDisposition: finalDisposition,
      permissionDisposition: finalDisposition === "allowed" ? "allowed" : "not_evaluated",
      approvalIds: [],
      reasonCodes: finalDisposition === "denied" ? ["contract_denied"] : [],
    },
    correlationId: invocationId,
  }
}

function result(
  invocationId: string,
  authorizationEventId: string,
  status: "completed" | "failed" | "cancelled" = "completed",
): EventInput {
  const payload =
    status === "completed"
      ? { invocationId, status, result: RESULT }
      : status === "failed"
        ? { invocationId, status, failure: { code: "executor_failed", message: "failed", retryable: false } }
        : { invocationId, status, cancellation: { code: "operator_cancelled", message: "cancelled" } }
  return {
    type: "tool_result_recorded",
    payload,
    correlationId: invocationId,
    causationId: authorizationEventId,
  }
}

function mutation(...invocationIds: string[]): EventInput {
  return {
    type: "mutation_recorded",
    payload: {
      basis: "native_snapshot_diff_v1",
      receipt: {
        schemaVersion: "dax.sdlc.mutation.v1",
        receiptId: "mut_native_1",
        runId: RUN_ID,
        claim: "1 file changed",
        proofType: "workspace_diff",
        source: "dax",
        changedPaths: ["src/a.ts"],
        recordedAt: "2026-08-29T00:00:00.000Z",
        digest: "c".repeat(64),
      },
      observationWindowInvocationIds: invocationIds,
    },
  }
}

function seed(...inputs: EventInput[]): RunEventEnvelope[] {
  const events = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: CONTRACT_ID })]
  inputs.forEach((input, index) => events.push(event(index + 1, input)))
  return events
}

function allowed(status: "completed" | "failed" | "cancelled" = "completed") {
  const events = seed(invocation())
  const authorizationEvent = event(2, authorization())
  events.push(authorizationEvent, event(3, result("inv_1", authorizationEvent.eventId, status)))
  return events
}

describe("canonical native execution event schemas", () => {
  test("the closed runtime vocabulary includes exactly the three frozen execution event names", () => {
    expect(RUN_EVENT_TYPES).toContain("tool_invocation_recorded")
    expect(RUN_EVENT_TYPES).toContain("authorization_recorded")
    expect(RUN_EVENT_TYPES).toContain("tool_result_recorded")
    expect(RUN_EVENT_TYPES).not.toContain("policy_decision_recorded" as RunEventType)
    expect(RUN_EVENT_TYPES).not.toContain("execution_observation_recorded" as RunEventType)
  })

  test("valid invocation, authorization, and completed result records parse together", () => {
    expect(parseRunEventLog(RUN_ID, allowed())).toHaveLength(4)
  })

  test("failed and cancelled terminal result shapes parse", () => {
    expect(parseRunEventLog(RUN_ID, allowed("failed"))).toHaveLength(4)
    expect(parseRunEventLog(RUN_ID, allowed("cancelled"))).toHaveLength(4)
  })

  test("closed execution payloads reject unknown top-level and nested fields", () => {
    const topLevel = seed(invocation("inv_1", { corruptExtra: true }))
    const nested = seed(invocation("inv_1", { input: { ...INPUT, rawSecret: "must-not-persist" } }))
    const authorizationExtra = seed(invocation(), {
      ...authorization(),
      payload: { ...(authorization().payload as Record<string, unknown>), corruptExtra: true },
    })
    const resultExtra = allowed()
    resultExtra[3] = {
      ...resultExtra[3],
      payload: { ...(resultExtra[3].payload as Record<string, unknown>), corruptExtra: true },
    }

    expect(() => parseRunEventLog(RUN_ID, topLevel)).toThrow(/corruptExtra/)
    expect(() => parseRunEventLog(RUN_ID, nested)).toThrow(/rawSecret/)
    expect(() => parseRunEventLog(RUN_ID, authorizationExtra)).toThrow(/corruptExtra/)
    expect(() => parseRunEventLog(RUN_ID, resultExtra)).toThrow(/corruptExtra/)
  })

  test("raw input and malformed or misidentified commitments are rejected", () => {
    const raw = seed(invocation("inv_1", { input: { command: "token=plaintext" } }))
    const malformedDigest = seed(invocation("inv_1", { input: { ...INPUT, digest: "not-a-digest" } }))
    const wrongBasis = seed(invocation("inv_1", { input: { ...INPUT, basis: RESULT.basis } }))
    const unknownCanonicalization = seed(
      invocation("inv_1", { input: { ...INPUT, canonicalization: "implementation-defined" } }),
    )

    expect(() => parseRunEventLog(RUN_ID, raw)).toThrow(/input/)
    expect(() => parseRunEventLog(RUN_ID, malformedDigest)).toThrow(/digest/)
    expect(() => parseRunEventLog(RUN_ID, wrongBasis)).toThrow(/basis/)
    expect(() => parseRunEventLog(RUN_ID, unknownCanonicalization)).toThrow(/canonicalization/)
  })

  test("result statuses enforce their discriminated payload contracts", () => {
    const missingCompletedResult = seed(invocation(), authorization(), {
      type: "tool_result_recorded",
      payload: { invocationId: "inv_1", status: "completed" },
      correlationId: "inv_1",
      causationId: "evt_auth",
    })
    const deniedResult = seed(invocation(), authorization(), {
      type: "tool_result_recorded",
      payload: { invocationId: "inv_1", status: "denied", failure: { code: "denied", message: "no" } },
      correlationId: "inv_1",
      causationId: "evt_auth",
    })

    expect(() => parseRunEventLog(RUN_ID, missingCompletedResult)).toThrow(/result/)
    expect(() => parseRunEventLog(RUN_ID, deniedResult)).toThrow(/status/)
  })

  test("cross-type payloads and mismatched envelope correlation are rejected", () => {
    const invocationPayload = invocation().payload as Record<string, unknown>
    const crossType = seed({
      type: "authorization_recorded",
      payload: invocationPayload,
      correlationId: "inv_1",
    })
    const badCorrelation = seed(invocation(), { ...authorization(), correlationId: "inv_other" })

    expect(() => parseRunEventLog(RUN_ID, crossType)).toThrow(/payload/)
    expect(() => parseRunEventLog(RUN_ID, badCorrelation)).toThrow(/correlationId/)
  })

  test("contradictory final authorization dispositions are rejected", () => {
    const allowedAfterDenial = seed(invocation(), {
      ...authorization(),
      payload: {
        ...(authorization().payload as Record<string, unknown>),
        contractDisposition: "denied",
      },
    })
    const deniedWithoutSource = seed(invocation(), {
      ...authorization("inv_1", "denied"),
      payload: {
        ...(authorization("inv_1", "denied").payload as Record<string, unknown>),
        contractDisposition: "allowed",
        runtimeGuardDisposition: "allowed",
        permissionDisposition: "allowed",
        reasonCodes: [],
      },
    })

    expect(() => parseRunEventLog(RUN_ID, allowedAfterDenial)).toThrow(/finalDisposition/)
    expect(() => parseRunEventLog(RUN_ID, deniedWithoutSource)).toThrow(/finalDisposition|reasonCodes/)
  })

  test("a result requires a causation reference at the envelope boundary", () => {
    const events = seed(invocation(), authorization(), {
      ...result("inv_1", "evt_auth"),
      causationId: undefined,
    })

    expect(() => parseRunEventLog(RUN_ID, events)).toThrow(/causationId/)
  })
})

describe("canonical native execution projection", () => {
  test("invocation-only replay preserves awaiting authorization uncertainty", () => {
    const state = reduceRunState(seed(invocation()))!

    expect(state.invocations.inv_1).toMatchObject({
      invocationId: "inv_1",
      status: "awaiting_authorization",
      authorizationEventId: null,
      resultEventId: null,
    })
  })

  test("allowed authorization without a result remains authorized and outcome-uncertain", () => {
    const events = seed(invocation())
    const authorizationEvent = event(2, authorization())
    events.push(authorizationEvent)

    expect(reduceRunState(events)?.invocations.inv_1).toMatchObject({
      status: "authorized",
      authorizationEventId: authorizationEvent.eventId,
      resultEventId: null,
    })
  })

  test("denied authorization is terminal without a tool result", () => {
    const state = reduceRunState(seed(invocation(), authorization("inv_1", "denied")))!

    expect(state.invocations.inv_1).toMatchObject({ status: "denied", resultEventId: null })
  })

  test.each(["completed", "failed", "cancelled"] as const)("projects a %s terminal result", (status) => {
    const state = reduceRunState(allowed(status))!

    expect(state.invocations.inv_1.status).toBe(status)
    expect(state.invocations.inv_1.resultEventId).not.toBeNull()
  })

  test("projects parentage and ordinal before the parent is terminal", () => {
    const state = reduceRunState(
      seed(
        invocation("inv_batch", { toolId: "batch", executor: { kind: "builtin", id: "batch" }, ordinal: 0 }),
        invocation("inv_child", { parentInvocationId: "inv_batch", ordinal: 2 }),
      ),
    )!

    expect(state.invocations.inv_batch.status).toBe("awaiting_authorization")
    expect(state.invocations.inv_child).toMatchObject({ parentInvocationId: "inv_batch", ordinal: 2 })
  })

  test("completion order remains independent from request ordinal", () => {
    const events = seed(invocation("inv_1", { ordinal: 0 }), invocation("inv_2", { ordinal: 1 }))
    const auth1 = event(3, authorization("inv_1"))
    const auth2 = event(4, authorization("inv_2"))
    events.push(auth1, auth2, event(5, result("inv_2", auth2.eventId)), event(6, result("inv_1", auth1.eventId)))

    const state = reduceRunState(events)!
    expect(state.invocations.inv_1).toMatchObject({ ordinal: 0, status: "completed" })
    expect(state.invocations.inv_2).toMatchObject({ ordinal: 1, status: "completed" })
  })
})

describe("canonical native execution invalid history", () => {
  test("rejects duplicate invocation identity", () => {
    expect(() => reduceRunState(seed(invocation(), invocation()))).toThrow(/already exists/)
  })

  test("rejects invocation contract mismatch", () => {
    expect(() => reduceRunState(seed(invocation("inv_1", { contractId: "ctr_other" })))).toThrow(/run contract/)
  })

  test("rejects missing parents but preserves deeper acyclic ancestry", () => {
    expect(() => reduceRunState(seed(invocation("inv_child", { parentInvocationId: "inv_missing" })))).toThrow(
      /parent invocation not found/i,
    )
    const state = reduceRunState(
      seed(
        invocation("inv_root"),
        invocation("inv_child", { parentInvocationId: "inv_root" }),
        invocation("inv_grandchild", { parentInvocationId: "inv_child" }),
      ),
    )!
    expect(state.invocations.inv_grandchild.parentInvocationId).toBe("inv_child")
  })

  test("retry identity requires an existing invocation for the same tool but not a terminal source", () => {
    expect(() => reduceRunState(seed(invocation("inv_retry", { retryOfInvocationId: "inv_missing" })))).toThrow(
      /retry source invocation not found/i,
    )
    expect(() =>
      reduceRunState(
        seed(
          invocation("inv_source", { toolId: "read", executor: { kind: "builtin", id: "read" } }),
          invocation("inv_retry", { retryOfInvocationId: "inv_source" }),
        ),
      ),
    ).toThrow(/retry source tool does not match/i)

    const state = reduceRunState(
      seed(invocation("inv_source"), invocation("inv_retry", { retryOfInvocationId: "inv_source" })),
    )!
    expect(state.invocations.inv_source.status).toBe("awaiting_authorization")
    expect(state.invocations.inv_retry.retryOfInvocationId).toBe("inv_source")
  })

  test("rejects authorization without an invocation and duplicate authorization", () => {
    expect(() => reduceRunState(seed(authorization()))).toThrow(/unknown invocation/)
    expect(() => reduceRunState(seed(invocation(), authorization(), authorization()))).toThrow(
      /already has authorization/,
    )
  })

  test("approval-backed authorization requires a resolved canonical approval", () => {
    const approvalAuthorization: EventInput = {
      type: "authorization_recorded",
      correlationId: "inv_1",
      payload: {
        invocationId: "inv_1",
        finalDisposition: "allowed",
        contractDisposition: "allowed",
        runtimeGuardDisposition: "approval_required",
        permissionDisposition: "allowed",
        approvalIds: ["apr_1"],
        reasonCodes: ["sensitive_path_approved"],
      },
    }

    expect(() => reduceRunState(seed(invocation(), approvalAuthorization))).toThrow(/unknown approval/)

    const requested = seed(
      { type: "execution_queued", payload: {} },
      { type: "execution_started", payload: {} },
      invocation(),
      {
        type: "approval_requested",
        payload: { approvalId: "apr_1", approvalType: "command", risk: "high" },
        correlationId: "inv_1",
      },
    )
    expect(() => reduceRunState([...requested, event(5, approvalAuthorization)])).toThrow(/unresolved approval/)

    const rejected = [
      ...requested,
      {
        ...event(5, {
          type: "approval_resolved",
          payload: { approvalId: "apr_1", decision: "rejected", actor: "operator" },
        }),
      },
    ]
    expect(() => reduceRunState([...rejected, event(6, approvalAuthorization)])).toThrow(/rejected approval/)

    const deniedAfterRejection: EventInput = {
      ...approvalAuthorization,
      payload: {
        ...(approvalAuthorization.payload as Record<string, unknown>),
        finalDisposition: "denied",
        reasonCodes: ["operator_rejected"],
      },
    }
    expect(reduceRunState([...rejected, event(6, deniedAfterRejection)])?.invocations.inv_1.status).toBe("denied")

    const approved = [
      ...requested,
      event(5, {
        type: "approval_resolved",
        payload: { approvalId: "apr_1", decision: "approved", actor: "operator" },
      }),
      event(6, approvalAuthorization),
    ]

    expect(reduceRunState(approved)?.invocations?.inv_1).toMatchObject({
      status: "authorized",
      approvalIds: ["apr_1"],
    })

    const workflowApproval = approved.map((entry) =>
      entry.type === "approval_requested" ? { ...entry, correlationId: undefined } : entry,
    )
    expect(() => reduceRunState(workflowApproval)).toThrow(/another authority subject/)
  })

  test("rejects result without invocation or authorization", () => {
    expect(() => reduceRunState(seed(result("inv_1", "evt_auth")))).toThrow(/unknown invocation/)
    expect(() => reduceRunState(seed(invocation(), result("inv_1", "evt_auth")))).toThrow(/no authorization/)
  })

  test("rejects result after denied authorization", () => {
    const events = seed(invocation())
    const denied = event(2, authorization("inv_1", "denied"))
    events.push(denied, event(3, result("inv_1", denied.eventId)))

    expect(() => reduceRunState(events)).toThrow(/from status denied/)
  })

  test("rejects duplicate terminal result", () => {
    const events = allowed()
    const authorizationEventId = events[2].eventId
    events.push(event(4, result("inv_1", authorizationEventId)))

    expect(() => reduceRunState(events)).toThrow(/from status completed|terminal result/)
  })

  test("rejects cross-invocation authorization causation", () => {
    const events = seed(invocation("inv_1"), invocation("inv_2"))
    const auth1 = event(3, authorization("inv_1"))
    const auth2 = event(4, authorization("inv_2"))
    events.push(auth1, auth2, event(5, result("inv_2", auth1.eventId)))

    expect(() => reduceRunState(events)).toThrow(/causation does not match/)
  })

  test("native mutation evidence requires an allowed invocation and projects the full receipt", () => {
    expect(() => reduceRunState(seed(mutation("inv_missing")))).toThrow(/unknown invocation/)
    expect(() => reduceRunState(seed(invocation(), mutation("inv_1")))).toThrow(/without allowed execution authority/)

    const events = seed(invocation())
    const authorizationEvent = event(2, authorization())
    events.push(authorizationEvent, event(3, mutation("inv_1")), event(4, result("inv_1", authorizationEvent.eventId)))
    const state = reduceRunState(events)!
    expect(state.governance.mutationReceiptIds).toEqual(["mut_native_1"])
    expect(state.governance.touchedFiles).toEqual(["src/a.ts"])
    expect(state.governance.verification.required).toBe(true)
  })

  test("native mutation payloads reject duplicate windows and unknown closed receipt fields", () => {
    const duplicate = seed(invocation())
    duplicate.push(event(2, authorization()), event(3, mutation("inv_1", "inv_1")))
    expect(() => reduceRunState(duplicate)).toThrow(/duplicate invocation/i)

    const malformed = mutation("inv_1")
    const payload = malformed.payload as { receipt: Record<string, unknown> }
    payload.receipt.corruptExtra = true
    expect(() => parseRunEventLog(RUN_ID, seed(malformed))).toThrow(/malformed event|invalid input/i)
  })
})

describe("workflow-step compatibility", () => {
  test("native execution projection never changes currentStepId or step semantics", () => {
    const events = seed(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "step_added", payload: { stepId: "step_1", title: "Workflow unit", stepType: "executed" } },
      { type: "step_started", payload: { stepId: "step_1" } },
      invocation(),
    )
    const authorizationEvent = event(6, authorization())
    events.push(authorizationEvent, event(7, result("inv_1", authorizationEvent.eventId)))

    const state = reduceRunState(events)!
    expect(state.currentStepId).toBe("step_1")
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0]).toMatchObject({ stepId: "step_1", status: "running" })
    expect(state.invocations.inv_1.status).toBe("completed")
  })

  test("historical canonical logs without native execution records replay unchanged", () => {
    const events = seed(
      { type: "execution_queued", payload: {} },
      { type: "workflow_started", payload: {} },
      { type: "step_added", payload: { stepId: "step_1", title: "Workflow unit", stepType: "executed" } },
      { type: "step_started", payload: { stepId: "step_1" } },
      { type: "step_completed", payload: { stepId: "step_1", outputs: ["artifact_1"] } },
    )

    const state = reduceRunState(events)!
    expect(state.currentStepId).toBeNull()
    expect(state.steps[0].status).toBe("completed")
    expect(state.invocations).toEqual({})
  })
})
