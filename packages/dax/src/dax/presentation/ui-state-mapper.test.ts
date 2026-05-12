import { describe, expect, test } from "bun:test"
import { resolveUIState, type EnvironmentHealth } from "./ui-state-resolver"
import { workstationToActiveUIState, type MapperInput } from "./ui-state-mapper"
import type { WorkstationLifecycle } from "./workstation"

const HEALTHY_ENV: EnvironmentHealth = { provider: "healthy", mcp: "healthy", lsp: "healthy" }

function input(overrides: Partial<MapperInput> = {}): MapperInput {
  return {
    lifecycle: "ready",
    actionableApprovals: 0,
    questions: 0,
    environment: HEALTHY_ENV,
    safety: [],
    focus: "none",
    ...overrides,
  }
}

describe("workstationToActiveUIState", () => {
  describe("lifecycle → run state", () => {
    const lifecycleCases: Array<[WorkstationLifecycle, string]> = [
      ["understanding", "working"],
      ["planning", "working"],
      ["executing", "working"],
      ["verifying", "working"],
      ["waiting_for_capacity", "cooling_down"],
      ["retrying", "provider_delayed"],
      ["blocked", "failed"],
      ["failed", "failed"],
      ["completed", "complete"],
      ["ready", "ready"],
    ]

    for (const [lifecycle, expectedRun] of lifecycleCases) {
      test(`${lifecycle} → run: ${expectedRun}`, () => {
        const state = workstationToActiveUIState(input({ lifecycle }))
        expect(state.run).toBe(expectedRun as never)
      })
    }
  })

  describe("awaiting_approval splits into user state", () => {
    test("actionable approval → waiting_for_approval", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "awaiting_approval", actionableApprovals: 1 }),
      )
      expect(state.user).toBe("waiting_for_approval")
      // Residual run state stays as background activity.
      expect(state.run).toBe("working")
    })

    test("question without approval → waiting_for_answer", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "awaiting_approval", actionableApprovals: 0, questions: 1 }),
      )
      expect(state.user).toBe("waiting_for_answer")
    })

    test("approval beats question when both are present", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "awaiting_approval", actionableApprovals: 1, questions: 3 }),
      )
      expect(state.user).toBe("waiting_for_approval")
    })

    test("awaiting_approval with zero counts produces user: null", () => {
      // Defensive: producer race condition where lifecycle says awaiting but
      // counts are zero. Mapper does not throw; resolver ladder handles it.
      const state = workstationToActiveUIState(input({ lifecycle: "awaiting_approval" }))
      expect(state.user).toBeNull()
    })

    test("non-awaiting lifecycle never populates user state", () => {
      const lifecycles: WorkstationLifecycle[] = [
        "understanding",
        "planning",
        "executing",
        "verifying",
        "waiting_for_capacity",
        "retrying",
        "blocked",
        "failed",
        "completed",
        "ready",
      ]
      for (const lifecycle of lifecycles) {
        const state = workstationToActiveUIState(
          input({ lifecycle, actionableApprovals: 5, questions: 5 }),
        )
        expect(state.user).toBeNull()
      }
    })
  })

  describe("future-state hints", () => {
    test("compacting overrides working", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "executing", compacting: true }))
      expect(state.run).toBe("compacting")
    })

    test("resuming overrides working", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "executing", resuming: true }))
      expect(state.run).toBe("resuming")
    })

    test("compacting takes precedence over resuming", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "executing", compacting: true, resuming: true }),
      )
      expect(state.run).toBe("compacting")
    })

    test("hints do not override failed lifecycle", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "failed", compacting: true }))
      expect(state.run).toBe("failed")
    })

    test("hints do not override awaiting_approval residual", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "awaiting_approval", actionableApprovals: 1, compacting: true }),
      )
      // The mapper preserves the awaiting-approval residual run state so the
      // resolver's user-state ladder remains the source of truth.
      expect(state.run).toBe("working")
      expect(state.user).toBe("waiting_for_approval")
    })

    test("hints do not override blocked → failed mapping", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "blocked", resuming: true }))
      expect(state.run).toBe("failed")
    })
  })

  describe("passthrough fields", () => {
    test("environment is passed through unchanged", () => {
      const env: EnvironmentHealth = { provider: "degraded", mcp: "unavailable", lsp: "healthy" }
      const state = workstationToActiveUIState(input({ environment: env }))
      expect(state.environment).toEqual(env)
    })

    test("safety array is passed through unchanged", () => {
      const state = workstationToActiveUIState(input({ safety: ["policy_blocked"] }))
      expect(state.safety).toEqual(["policy_blocked"])
    })

    test("focus is passed through unchanged", () => {
      const state = workstationToActiveUIState(input({ focus: "input" }))
      expect(state.focus).toBe("input")
    })
  })

  describe("safety is independent of lifecycle", () => {
    test("producer's blocked lifecycle still maps to run: failed even when safety is set", () => {
      // The mapper does not invent safety from the producer's overloaded
      // lifecycle. Safety must come from the explicit input.
      const state = workstationToActiveUIState(
        input({ lifecycle: "blocked", safety: ["auth_required"] }),
      )
      expect(state.run).toBe("failed")
      expect(state.safety).toEqual(["auth_required"])
    })

    test("safety stacks: policy_blocked and auth_required both pass through", () => {
      const state = workstationToActiveUIState(
        input({ safety: ["policy_blocked", "auth_required"] }),
      )
      expect(state.safety).toEqual(["policy_blocked", "auth_required"])
    })
  })

  describe("end-to-end: mapper output feeds resolver cleanly", () => {
    test("awaiting_approval through the pipeline shows approval card", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "awaiting_approval", actionableApprovals: 2 }),
      )
      const projection = resolveUIState(state, 1_000, null)
      expect(projection.header.state).toBe("waiting_for_approval")
      expect(projection.inspector.state).toBe("approval_card")
    })

    test("safety raised externally produces a safety-block projection regardless of lifecycle", () => {
      const state = workstationToActiveUIState(
        input({ lifecycle: "executing", safety: ["policy_blocked"] }),
      )
      const projection = resolveUIState(state, 1_000, null)
      expect(projection.header.state).toBe("policy_blocked")
      expect(projection.inspector.state).toBe("safety_block")
    })

    test("waiting_for_capacity produces a cooling_down header", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "waiting_for_capacity" }))
      const projection = resolveUIState(state, 1_000, null)
      expect(projection.header.state).toBe("cooling_down")
      expect(projection.header.label).toBe("DAX · Cooling down")
    })

    test("retrying produces a provider_delayed header (not 'blocked')", () => {
      // This is the core relabeling win the contract demanded: provider
      // throttling no longer surfaces as 'Blocked' anywhere.
      const state = workstationToActiveUIState(input({ lifecycle: "retrying" }))
      const projection = resolveUIState(state, 1_000, null)
      expect(projection.header.state).toBe("provider_delayed")
      expect(projection.header.label).toBe("DAX · Provider delayed")
    })

    test("completed lifecycle produces a complete header with decay anchor", () => {
      const state = workstationToActiveUIState(input({ lifecycle: "completed" }))
      const projection = resolveUIState(state, 5_000, null)
      expect(projection.header.state).toBe("complete")
      expect(projection.header.completedAt).toBe(5_000)
    })
  })

  describe("determinism", () => {
    test("same input always produces equal output", () => {
      const inp = input({ lifecycle: "executing", compacting: true, focus: "transcript" })
      const a = workstationToActiveUIState(inp)
      const b = workstationToActiveUIState(inp)
      expect(a).toEqual(b)
    })
  })
})
