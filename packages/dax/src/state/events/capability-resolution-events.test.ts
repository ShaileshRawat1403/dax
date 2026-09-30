import { describe, expect, test } from "bun:test"
import { createEvent, parseRunEventLog, type RunEventEnvelope, type RunEventType } from "./run-event-types"
import { reduceRunState } from "./run-reducer"

/**
 * The record-only capability resolution event. These tests pin two things: it
 * can never be written or read as an enforced authorization, and its presence
 * or absence changes nothing the runtime reads authority from.
 */

const RUN_ID = "run_capability_resolution"
const CONTRACT_ID = "ctr_capability_resolution"
const INPUT = {
  basis: "validated_tool_input" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"a".repeat(64)}`,
  redactedPreview: "{}",
  truncated: false,
}

type EventInput = { type: RunEventType; payload: unknown; correlationId?: string }

function log(...inputs: EventInput[]): RunEventEnvelope[] {
  const events = [createEvent(RUN_ID, 0, "contract_compiled", { contractId: CONTRACT_ID })]
  inputs.forEach((input, index) =>
    events.push({
      ...createEvent(RUN_ID, index + 1, input.type, input.payload),
      eventId: `evt_test_${index + 1}_${input.type}`,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    }),
  )
  return events
}

const invocation = (invocationId = "inv_1"): EventInput => ({
  type: "tool_invocation_recorded",
  payload: {
    invocationId,
    toolId: "read",
    input: INPUT,
    contractId: CONTRACT_ID,
    executor: { kind: "builtin", id: "read" },
  },
})

const resolution = (subjectId = "inv_1", overrides: Record<string, unknown> = {}): EventInput => ({
  type: "capability_resolution_recorded",
  payload: {
    subjectId,
    enforcement: "record_only",
    path: "native_tool",
    initiator: "model",
    capabilityId: "native.tool.read",
    enrolled: true,
    basis: "v1_contract",
    contractId: CONTRACT_ID,
    decision: "allow",
    ...overrides,
  },
  correlationId: subjectId,
})

const authorization = (invocationId = "inv_1", finalDisposition: "allowed" | "denied" = "allowed"): EventInput => ({
  type: "authorization_recorded",
  payload: {
    invocationId,
    finalDisposition,
    contractDisposition: finalDisposition,
    runtimeGuardDisposition: finalDisposition === "allowed" ? "allowed" : "not_evaluated",
    permissionDisposition: finalDisposition === "allowed" ? "allowed" : "not_evaluated",
    approvalIds: [],
    reasonCodes: finalDisposition === "denied" ? ["contract_tool_denied"] : [],
  },
  correlationId: invocationId,
})

const parses = (...inputs: EventInput[]) => () => parseRunEventLog(RUN_ID, log(...inputs))

describe("record-only capability resolution events", () => {
  test("a resolution replays into its own list and is never an authorization", () => {
    const state = reduceRunState(parseRunEventLog(RUN_ID, log(invocation(), resolution(), authorization())))!
    expect(state.capabilityResolutions).toHaveLength(1)
    expect(state.capabilityResolutions[0]).toMatchObject({
      subjectId: "inv_1",
      enforcement: "record_only",
      capabilityId: "native.tool.read",
      decision: "allow",
      eventId: "evt_test_2_capability_resolution_recorded",
    })
    expect(state.invocations["inv_1"]).toMatchObject({
      status: "authorized",
      authorizationEventId: "evt_test_3_authorization_recorded",
    })
  })

  test("the enforcement marker cannot say anything but record only", () => {
    for (const enforcement of ["enforced", "authorized", "", undefined]) {
      expect(parses(invocation(), resolution("inv_1", { enforcement }))).toThrow("malformed event")
    }
    // It carries no authority-bearing field either.
    for (const field of ["finalDisposition", "approvalIds", "grants", "authorizationEventId"]) {
      expect(parses(invocation(), resolution("inv_1", { [field]: [] }))).toThrow("malformed event")
    }
  })

  test("a shadow decision does not decide: a recorded deny neither denies nor blocks authorization", () => {
    const shadowDeny = resolution("inv_1", { decision: "deny", reasonCode: "grant_absent" })
    const state = reduceRunState(parseRunEventLog(RUN_ID, log(invocation(), shadowDeny, authorization())))!
    expect(state.capabilityResolutions[0].decision).toBe("deny")
    expect(state.invocations["inv_1"].status).toBe("authorized")

    // And a recorded allow does not authorize: the invocation still waits.
    const waiting = reduceRunState(parseRunEventLog(RUN_ID, log(invocation(), resolution())))!
    expect(waiting.invocations["inv_1"]).toMatchObject({ status: "awaiting_authorization", authorizationEventId: null })
    const denied = reduceRunState(
      parseRunEventLog(RUN_ID, log(invocation(), resolution(), authorization("inv_1", "denied"))),
    )!
    expect(denied.invocations["inv_1"].status).toBe("denied")
  })

  test("a log without resolution events replays to the same authority state", () => {
    const withShadow = reduceRunState(parseRunEventLog(RUN_ID, log(invocation(), resolution(), authorization())))!
    const without = reduceRunState(parseRunEventLog(RUN_ID, log(invocation(), authorization())))!
    expect(without.capabilityResolutions).toEqual([])
    const authority = (state: typeof withShadow) => ({
      status: state.status,
      contractId: state.contractId,
      invocation: { ...state.invocations["inv_1"], authorizationEventId: "normalized" },
    })
    expect(authority(withShadow)).toEqual(authority(without))
  })

  test("a resolution must name a known action, precede its authorization, and be unique", () => {
    const reduce = (...inputs: EventInput[]) => () => reduceRunState(parseRunEventLog(RUN_ID, log(...inputs)))
    expect(reduce(resolution())).toThrow("unknown invocation")
    expect(reduce(invocation(), authorization(), resolution())).toThrow("must precede its authorization")
    expect(reduce(invocation(), resolution(), resolution())).toThrow("already recorded")
    expect(reduce(invocation(), { ...resolution(), correlationId: "inv_other" })).toThrow("correlation")
    expect(reduce(invocation(), resolution("inv_1", { contractId: "ctr_other" }))).toThrow("does not match run contract")
  })

  test("an operator action has no invocation to reference", () => {
    const shell = resolution("call_shell", {
      path: "operator_shell",
      initiator: "operator",
      capabilityId: "session.shell.operator",
    })
    const state = reduceRunState(parseRunEventLog(RUN_ID, log(shell)))!
    expect(state.capabilityResolutions[0]).toMatchObject({ path: "operator_shell", initiator: "operator" })
    expect(state.invocations).toEqual({})
  })

  test("the record states its own facts consistently", () => {
    // An unenrolled executor has no identity to record; an enrolled one must.
    expect(parses(invocation(), resolution("inv_1", { enrolled: false }))).toThrow("malformed event")
    expect(parses(invocation(), resolution("inv_1", { capabilityId: undefined }))).toThrow("malformed event")
    expect(parses(invocation(), resolution("inv_1", { enrolled: false, capabilityId: undefined }))).not.toThrow()
    // A denial names its reason.
    expect(parses(invocation(), resolution("inv_1", { decision: "deny" }))).toThrow("malformed event")
    // A grant scope appears only when a v2 grant matched.
    expect(parses(invocation(), resolution("inv_1", { grantScope: "run" }))).toThrow("malformed event")
    expect(parses(invocation(), resolution("inv_1", { basis: "v2_grant", grantScope: "run" }))).not.toThrow()
    expect(parses(invocation(), resolution("inv_1", { basis: "v2_grant" }))).toThrow("malformed event")
    // No contract means no contract ID.
    expect(parses(invocation(), resolution("inv_1", { basis: "no_contract" }))).toThrow("malformed event")
  })
})
