import { describe, expect, test } from "bun:test"
import { createEvent, parseRunEventLog, type RunEventEnvelope, type RunEventType } from "./run-event-types"
import { reduceRunState } from "./run-reducer"

const RUN_ID = "run_delegation"
const CONTRACT_ID = "ctr_delegation"
const INPUT = {
  basis: "validated_tool_input" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"a".repeat(64)}`,
  redactedPreview: '{"subagent_type":"general"}',
  truncated: false,
}
const RESULT = {
  basis: "validated_dax_result_pre_truncation" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"b".repeat(64)}`,
  redactedPreview: '{"sessionId":"ses_child"}',
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
    eventId: `evt_${seq}_${input.type}`,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {}),
  }
}

function invocation(invocationId: string, toolId = "task"): EventInput {
  return {
    type: "tool_invocation_recorded",
    payload: {
      invocationId,
      toolId,
      input: INPUT,
      contractId: CONTRACT_ID,
      executor: { kind: "builtin", id: toolId },
      originTurnId: "msg_parent",
    },
  }
}

function authorization(invocationId: string, disposition: "allowed" | "denied" = "allowed"): EventInput {
  return {
    type: "authorization_recorded",
    payload: {
      invocationId,
      finalDisposition: disposition,
      contractDisposition: disposition,
      runtimeGuardDisposition: disposition,
      permissionDisposition: disposition === "allowed" ? "allowed" : "not_evaluated",
      approvalIds: [],
      reasonCodes: disposition === "denied" ? ["contract_denied"] : [],
    },
    correlationId: invocationId,
  }
}

function delegation(
  invocationId: string,
  authorizationEventId: string,
  extras: Partial<{
    parentSessionId: string
    childSessionId: string
    agent: string
    mode: "created" | "resumed"
  }> = {},
): EventInput {
  return {
    type: "delegation_recorded",
    payload: {
      invocationId,
      parentSessionId: "ses_parent",
      childSessionId: "ses_child",
      agent: "general",
      mode: "created",
      ...extras,
    },
    correlationId: invocationId,
    causationId: authorizationEventId,
  }
}

function result(invocationId: string, authorizationEventId: string): EventInput {
  return {
    type: "tool_result_recorded",
    payload: { invocationId, status: "completed", result: RESULT },
    correlationId: invocationId,
    causationId: authorizationEventId,
  }
}

function seed(...inputs: EventInput[]): RunEventEnvelope[] {
  const events = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: CONTRACT_ID })]
  inputs.forEach((input, index) => events.push(event(index + 1, input)))
  return events
}

function authorized(invocationId: string): { events: RunEventEnvelope[]; authorizationEvent: RunEventEnvelope } {
  const events = seed(invocation(invocationId))
  const authorizationEvent = event(2, authorization(invocationId))
  events.push(authorizationEvent)
  return { events, authorizationEvent }
}

describe("delegation event schema", () => {
  test("accepts metadata-only provenance bound to authorization", () => {
    const { events, authorizationEvent } = authorized("inv_task")
    events.push(event(3, delegation("inv_task", authorizationEvent.eventId)))

    expect(parseRunEventLog(RUN_ID, events)).toHaveLength(4)
    expect(JSON.stringify(events)).not.toContain("Perform the secret task")
  })

  test("rejects malformed identity, correlation, causation, and self-delegation", () => {
    const { events, authorizationEvent } = authorized("inv_task")
    const valid = event(3, delegation("inv_task", authorizationEvent.eventId))

    expect(() => parseRunEventLog(RUN_ID, [...events, { ...valid, correlationId: "inv_other" }])).toThrow(
      /correlationId/,
    )
    expect(() => parseRunEventLog(RUN_ID, [...events, { ...valid, causationId: undefined }])).toThrow(/causationId/)
    expect(() =>
      parseRunEventLog(RUN_ID, [
        ...events,
        {
          ...valid,
          payload: { ...(valid.payload as object), childSessionId: "ses_parent" },
        },
      ]),
    ).toThrow(/childSessionId/)
  })
})

describe("delegation projection authority", () => {
  test("projects authorized selection without claiming child execution", () => {
    const { events, authorizationEvent } = authorized("inv_task")
    const delegationEvent = event(3, delegation("inv_task", authorizationEvent.eventId))
    events.push(delegationEvent)

    const state = reduceRunState(events)!
    expect(state.invocations.inv_task.status).toBe("authorized")
    expect(state.delegationHistory).toEqual({
      coverage: "complete",
      records: [
        {
          invocationId: "inv_task",
          parentSessionId: "ses_parent",
          childSessionId: "ses_child",
          agent: "general",
          mode: "created",
          authorizationEventId: authorizationEvent.eventId,
          eventId: delegationEvent.eventId,
          recordedAt: delegationEvent.occurredAt,
        },
      ],
      missingInvocationIds: [],
      uncapturedCreationSessionIds: [],
    })
  })

  test("requires an existing currently authorized task invocation and exact causation", () => {
    const unknown = seed(delegation("inv_missing", "evt_auth"))
    expect(() => reduceRunState(unknown)).toThrow(/unknown invocation/)

    const shell = seed(invocation("inv_shell", "shell"))
    const shellAuthorization = event(2, authorization("inv_shell"))
    shell.push(shellAuthorization, event(3, delegation("inv_shell", shellAuthorization.eventId)))
    expect(() => reduceRunState(shell)).toThrow(/non-task invocation/)

    const denied = seed(invocation("inv_denied"))
    const deniedAuthorization = event(2, authorization("inv_denied", "denied"))
    denied.push(deniedAuthorization, event(3, delegation("inv_denied", deniedAuthorization.eventId)))
    expect(() => reduceRunState(denied)).toThrow(/status denied/)

    const wrongCausation = authorized("inv_wrong_cause")
    wrongCausation.events.push(event(3, delegation("inv_wrong_cause", "evt_other_auth")))
    expect(() => reduceRunState(wrongCausation.events)).toThrow(/causation/)

    const settled = authorized("inv_settled")
    settled.events.push(event(3, result("inv_settled", settled.authorizationEvent.eventId)))
    settled.events.push(event(4, delegation("inv_settled", settled.authorizationEvent.eventId)))
    expect(() => reduceRunState(settled.events)).toThrow(/status completed/)
  })

  test("rejects second delegation even when its command identity could differ", () => {
    const { events, authorizationEvent } = authorized("inv_duplicate")
    events.push(
      event(3, delegation("inv_duplicate", authorizationEvent.eventId)),
      event(4, delegation("inv_duplicate", authorizationEvent.eventId, { childSessionId: "ses_other" })),
    )

    expect(() => reduceRunState(events)).toThrow(/already has a delegation/)
  })

  test("resumption does not invent or overwrite original creation lineage", () => {
    const resumed = authorized("inv_resume")
    resumed.events.push(
      event(
        3,
        delegation("inv_resume", resumed.authorizationEvent.eventId, {
          parentSessionId: "ses_current_delegator",
          childSessionId: "ses_historical_child",
          mode: "resumed",
        }),
      ),
    )
    const projected = reduceRunState(resumed.events)!
    expect(projected.delegationHistory).toMatchObject({
      coverage: "partial",
      uncapturedCreationSessionIds: ["ses_historical_child"],
      records: [
        {
          parentSessionId: "ses_current_delegator",
          childSessionId: "ses_historical_child",
          mode: "resumed",
        },
      ],
    })

    const inventedCreation = [...resumed.events]
    const later = invocation("inv_later")
    inventedCreation.push(event(4, later), event(5, authorization("inv_later")))
    inventedCreation.push(
      event(6, delegation("inv_later", inventedCreation[5].eventId, { childSessionId: "ses_historical_child" })),
    )
    expect(() => reduceRunState(inventedCreation)).toThrow(/invent creation lineage/)
  })
})

describe("delegation record coverage", () => {
  test("zero task invocations, denied-only, and awaiting authorization are complete", () => {
    expect(reduceRunState(seed())?.delegationHistory.coverage).toBe("complete")
    expect(
      reduceRunState(seed(invocation("inv_denied"), authorization("inv_denied", "denied")))?.delegationHistory,
    ).toMatchObject({ coverage: "complete", missingInvocationIds: [] })
    expect(reduceRunState(seed(invocation("inv_waiting")))?.delegationHistory).toMatchObject({
      coverage: "complete",
      missingInvocationIds: [],
    })
  })

  test("authorized or historical settled tasks without records are unavailable", () => {
    const pending = authorized("inv_interrupted")
    expect(reduceRunState(pending.events)?.delegationHistory).toMatchObject({
      coverage: "unavailable",
      missingInvocationIds: ["inv_interrupted"],
    })

    const historical = authorized("inv_historical")
    historical.events.push(event(3, result("inv_historical", historical.authorizationEvent.eventId)))
    expect(reduceRunState(historical.events)?.delegationHistory).toMatchObject({
      coverage: "unavailable",
      missingInvocationIds: ["inv_historical"],
    })
  })

  test("mixed recorded and historical task invocations are partial", () => {
    const events = seed(invocation("inv_recorded"))
    const authRecorded = event(2, authorization("inv_recorded"))
    events.push(authRecorded, event(3, delegation("inv_recorded", authRecorded.eventId)))
    events.push(event(4, invocation("inv_historical")))
    const authHistorical = event(5, authorization("inv_historical"))
    events.push(authHistorical, event(6, result("inv_historical", authHistorical.eventId)))

    expect(reduceRunState(events)?.delegationHistory).toMatchObject({
      coverage: "partial",
      missingInvocationIds: ["inv_historical"],
    })
  })
})
