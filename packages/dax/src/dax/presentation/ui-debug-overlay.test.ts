import { describe, expect, test } from "bun:test"
import { formatDebugOverlay } from "./ui-debug-overlay"
import {
  IDLE_ACTIVE_UI_STATE,
  IDLE_UI_PROJECTION,
  resolveUIState,
  type ActiveUIState,
} from "./ui-state-resolver"

function active(overrides: Partial<ActiveUIState> = {}): ActiveUIState {
  return {
    ...IDLE_ACTIVE_UI_STATE,
    ...overrides,
    environment: { ...IDLE_ACTIVE_UI_STATE.environment, ...overrides.environment },
    safety: overrides.safety ?? IDLE_ACTIVE_UI_STATE.safety,
  }
}

describe("formatDebugOverlay", () => {
  test("renders the idle projection cleanly", () => {
    const output = formatDebugOverlay(IDLE_ACTIVE_UI_STATE, IDLE_UI_PROJECTION)
    expect(output).toContain("Active")
    expect(output).toContain("run: ready")
    expect(output).toContain("user: null")
    expect(output).toContain("safety: []")
    expect(output).toContain("environment: { provider: healthy, mcp: healthy, lsp: healthy }")
    expect(output).toContain("focus: none")
    expect(output).toContain("Resolved")
    expect(output).toContain("header: DAX · Ready")
    expect(output).toContain("winner: run.ready")
    expect(output).toContain("priority: 12")
    expect(output).toContain("inspector: closed")
    expect(output).toContain("footer: healthy")
  })

  test("shows winner annotation for the contract Section 10 example", () => {
    const state = active({
      run: "cooling_down",
      user: "waiting_for_approval",
      environment: { provider: "healthy", mcp: "degraded", lsp: "healthy" },
      focus: "inspector",
    })
    const projection = resolveUIState(state, 1_000, null)
    const output = formatDebugOverlay(state, projection)

    expect(output).toContain("run: cooling_down")
    expect(output).toContain("user: waiting_for_approval")
    expect(output).toContain("focus: inspector")
    expect(output).toContain("environment: { provider: healthy, mcp: degraded, lsp: healthy }")

    expect(output).toContain("header: DAX · Waiting for you")
    expect(output).toContain("winner: user.waiting_for_approval")
    expect(output).toContain("priority: 4")
    expect(output).toContain("inspector: approval_card")
    expect(output).toContain("opened_by: user.waiting_for_approval")
    expect(output).toContain("focus_trap: true")
    expect(output).toContain("footer: degraded")
    expect(output).toContain("reason: mcp degraded")
  })

  test("renders safety array contents", () => {
    const state = active({ safety: ["policy_blocked", "auth_required"] })
    const projection = resolveUIState(state, 1_000, null)
    const output = formatDebugOverlay(state, projection)
    expect(output).toContain("safety: [policy_blocked, auth_required]")
  })

  test("includes completedAt only when header state is complete", () => {
    const completeState = active({ run: "complete" })
    const completeProjection = resolveUIState(completeState, 7_000, null)
    const completeOutput = formatDebugOverlay(completeState, completeProjection)
    expect(completeOutput).toContain("completedAt: 7000")

    const workingOutput = formatDebugOverlay(
      active({ run: "working" }),
      resolveUIState(active({ run: "working" }), 7_000, null),
    )
    expect(workingOutput).not.toContain("completedAt")
  })

  test("omits inspector opened_by when inspector is closed", () => {
    const output = formatDebugOverlay(IDLE_ACTIVE_UI_STATE, IDLE_UI_PROJECTION)
    expect(output).not.toContain("opened_by")
    expect(output).not.toContain("focus_trap")
  })

  test("omits footer reason when environment is healthy", () => {
    const output = formatDebugOverlay(IDLE_ACTIVE_UI_STATE, IDLE_UI_PROJECTION)
    expect(output).not.toContain("reason:")
  })

  test("output is a single string with Active and Resolved sections separated by a blank line", () => {
    const output = formatDebugOverlay(IDLE_ACTIVE_UI_STATE, IDLE_UI_PROJECTION)
    const sections = output.split("\n\n")
    expect(sections).toHaveLength(2)
    expect(sections[0]!.startsWith("Active")).toBe(true)
    expect(sections[1]!.startsWith("Resolved")).toBe(true)
  })

  test("is deterministic for the same inputs", () => {
    const state = active({ run: "working", focus: "input" })
    const projection = resolveUIState(state, 1_000, null)
    const a = formatDebugOverlay(state, projection)
    const b = formatDebugOverlay(state, projection)
    expect(a).toBe(b)
  })
})
