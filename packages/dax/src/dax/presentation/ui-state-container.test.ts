import { describe, expect, test } from "bun:test"
import { resolveWorkstationUIState, type UIStateContainerInput } from "./ui-state-container"
import { deriveWorkstationState } from "./workstation"
import type { EnvironmentHealth } from "./ui-state-resolver"

const HEALTHY_ENV: EnvironmentHealth = { provider: "healthy", mcp: "healthy", lsp: "healthy" }

function workstation(
  overrides: Partial<Parameters<typeof deriveWorkstationState>[0]> = {},
) {
  return deriveWorkstationState({
    sessionID: "s1",
    stage: "executing",
    stageReason: "working",
    sessionStatusType: "busy",
    todo: [],
    approvals: [],
    questions: 0,
    artifacts: [],
    diffCount: 0,
    ...overrides,
  })
}

function input(overrides: Partial<UIStateContainerInput> = {}): UIStateContainerInput {
  return {
    workstation: workstation(),
    actionableApprovals: 0,
    questions: 0,
    environment: HEALTHY_ENV,
    safety: [],
    focus: "none",
    now: 1_000,
    previous: null,
    ...overrides,
  }
}

describe("resolveWorkstationUIState", () => {
  test("executing workstation produces a working header", () => {
    const projection = resolveWorkstationUIState(input())
    expect(projection.header.state).toBe("working")
    expect(projection.header.label).toBe("DAX · Working")
    expect(projection.inspector.state).toBe("closed")
    expect(projection.footer.health).toBe("healthy")
  })

  test("preserves the approval/question split lost by WorkstationState aggregation", () => {
    // WorkstationState aggregates approvals + questions into pendingCount.
    // The container must accept the separated counts and let the mapper
    // distinguish approval from answer.
    const ws = workstation({
      stage: "waiting",
      approvals: [{ label: "shell", status: "pending" }],
      questions: 3,
    })
    expect(ws.lifecycle).toBe("awaiting_approval")
    expect(ws.approvalSummary.pendingCount).toBe(4) // 1 approval + 3 questions, aggregate

    const withApproval = resolveWorkstationUIState(
      input({ workstation: ws, actionableApprovals: 1, questions: 3 }),
    )
    expect(withApproval.header.state).toBe("waiting_for_approval")
    expect(withApproval.inspector.state).toBe("approval_card")

    const questionOnly = workstation({ stage: "waiting", approvals: [], questions: 2 })
    expect(questionOnly.lifecycle).toBe("awaiting_approval")
    const withQuestion = resolveWorkstationUIState(
      input({ workstation: questionOnly, actionableApprovals: 0, questions: 2 }),
    )
    expect(withQuestion.header.state).toBe("waiting_for_answer")
    expect(withQuestion.inspector.state).toBe("question_card")
  })

  test("does not recompute lifecycle: container uses WorkstationState.lifecycle verbatim", () => {
    // Sanity check: if we pass actionable approvals but the workstation
    // lifecycle is NOT awaiting_approval (i.e., the producer didn't promote
    // it), the user state stays null. The container does not second-guess
    // the producer.
    const ws = workstation({ stage: "executing", approvals: [] })
    expect(ws.lifecycle).toBe("executing")
    const projection = resolveWorkstationUIState(
      input({ workstation: ws, actionableApprovals: 99, questions: 99 }),
    )
    expect(projection.header.state).toBe("working")
    expect(projection.inspector.state).toBe("closed")
  })

  test("safety from upstream overrides everything", () => {
    const projection = resolveWorkstationUIState(input({ safety: ["policy_blocked"] }))
    expect(projection.header.state).toBe("policy_blocked")
    expect(projection.inspector.state).toBe("safety_block")
  })

  test("environment health flows to the footer", () => {
    const projection = resolveWorkstationUIState(
      input({ environment: { provider: "healthy", mcp: "degraded", lsp: "healthy" } }),
    )
    expect(projection.footer.health).toBe("degraded")
    expect(projection.footer.reason).toBe("mcp degraded")
  })

  test("complete decay is preserved when previous is threaded", () => {
    const completedWs = workstation({ stage: "done" })
    expect(completedWs.lifecycle).toBe("completed")
    const first = resolveWorkstationUIState(
      input({ workstation: completedWs, now: 1_000, previous: null }),
    )
    expect(first.header.state).toBe("complete")
    expect(first.header.completedAt).toBe(1_000)

    const persisted = resolveWorkstationUIState(
      input({ workstation: completedWs, now: 2_500, previous: first }),
    )
    expect(persisted.header.state).toBe("complete")
    expect(persisted.header.completedAt).toBe(1_000)

    const decayed = resolveWorkstationUIState(
      input({ workstation: completedWs, now: 4_500, previous: persisted }),
    )
    expect(decayed.header.state).toBe("ready")
    expect(decayed.header.completedAt).toBeUndefined()
  })

  test("retrying lifecycle no longer surfaces as 'blocked'", () => {
    const retryingWs = workstation({ stage: "retrying", sessionStatusType: "retry" })
    expect(retryingWs.lifecycle).toBe("retrying")
    const projection = resolveWorkstationUIState(input({ workstation: retryingWs }))
    expect(projection.header.state).toBe("provider_delayed")
    expect(projection.header.label).toBe("DAX · Provider delayed")
  })

  test("provider capacity surfaces as cooling_down, not blocked", () => {
    const delayedWs = workstation({ sessionStatusType: "delayed" })
    expect(delayedWs.lifecycle).toBe("waiting_for_capacity")
    const projection = resolveWorkstationUIState(input({ workstation: delayedWs }))
    expect(projection.header.state).toBe("cooling_down")
    expect(projection.header.label).toBe("DAX · Cooling down")
  })

  test("compacting hint takes effect when no governance state wins", () => {
    const projection = resolveWorkstationUIState(input({ compacting: true }))
    expect(projection.header.state).toBe("compacting")
  })

  test("resuming hint takes effect when no governance state wins", () => {
    const projection = resolveWorkstationUIState(input({ resuming: true }))
    expect(projection.header.state).toBe("resuming")
  })

  test("determinism: same input always produces equal output", () => {
    const inp = input({
      safety: ["policy_blocked"],
      environment: { provider: "degraded", mcp: "healthy", lsp: "unavailable" },
    })
    const a = resolveWorkstationUIState(inp)
    const b = resolveWorkstationUIState(inp)
    expect(a).toEqual(b)
  })
})
