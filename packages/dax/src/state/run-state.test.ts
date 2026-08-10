import { describe, expect, test } from "bun:test"
import {
  LEGAL_TRANSITIONS,
  RunStatusExternalSchema,
  RunStatusSchema,
  createInitialRunState,
  isLegalTransition,
  isStepTerminalStatus,
  isTerminalStatus,
  toExternalStatus,
  type RunStatus,
} from "./run-state"

const ALL_STATUSES = RunStatusSchema.options

describe("run state machine", () => {
  test("every status appears in the transition table", () => {
    // A status missing here would make isLegalTransition throw on lookup
    // rather than return false, so adding one without an entry fails loudly
    // in production instead of here.
    for (const status of ALL_STATUSES) {
      expect(LEGAL_TRANSITIONS[status]).toBeDefined()
    }
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort())
  })

  test("every transition target is itself a real status", () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL_STATUSES).toContain(to)
        expect(to).not.toBe(from)
      }
    }
  })

  test("terminal statuses are exactly the ones with no way out", () => {
    // isTerminalStatus and LEGAL_TRANSITIONS encode the same fact separately.
    // If they drift, a run can be terminal by one definition and still
    // transition by the other.
    const noExit = ALL_STATUSES.filter((status) => LEGAL_TRANSITIONS[status].length === 0)
    const terminal = ALL_STATUSES.filter((status) => isTerminalStatus(status))

    expect([...noExit].sort()).toEqual([...terminal].sort())
    expect(terminal.sort()).toEqual(["cancelled", "completed", "failed"])
  })

  test("no status can reach itself, and terminal statuses accept nothing", () => {
    for (const status of ALL_STATUSES) {
      expect(isLegalTransition(status, status)).toBe(false)
    }
    for (const terminal of ["completed", "failed", "cancelled"] as const) {
      for (const target of ALL_STATUSES) {
        expect(isLegalTransition(terminal, target)).toBe(false)
      }
    }
  })

  test("every non-initial status is reachable from created", () => {
    // Guards against a status that exists in the enum but that no run can ever
    // enter, which is how a dead branch of the reducer survives unnoticed.
    const seen = new Set<RunStatus>(["created"])
    const queue: RunStatus[] = ["created"]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of LEGAL_TRANSITIONS[current]) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect([...seen].sort()).toEqual([...ALL_STATUSES].sort())
  })

  test("the lifecycle only moves forward, apart from the approval loop", () => {
    // Structural invariants alone do not catch a spurious but well-formed edge
    // being added, so the ordering itself is pinned. waiting_approval ->
    // running is the one sanctioned backward step: a run resumes after its
    // gate clears.
    const rank: Record<RunStatus, number> = {
      created: 0,
      compiled: 1,
      queued: 2,
      running: 3,
      waiting_approval: 4,
      completed: 5,
      failed: 5,
      cancelled: 5,
    }

    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS) as [RunStatus, RunStatus[]][]) {
      for (const to of targets) {
        if (from === "waiting_approval" && to === "running") continue
        expect(rank[to]).toBeGreaterThan(rank[from])
      }
    }
  })

  test("a run can always be abandoned before it finishes", () => {
    // Cancellation has to stay reachable from every live status, or a run can
    // enter a state it cannot be given up from.
    for (const status of ALL_STATUSES.filter((s) => !isTerminalStatus(s))) {
      expect(isLegalTransition(status, "cancelled")).toBe(true)
    }
  })

  test("a run starts in created with clean governance counters", () => {
    const state = createInitialRunState("run_1", "ctr_1")

    expect(state.status).toBe("created")
    expect(state.startedAt).toBeNull()
    expect(state.completedAt).toBeNull()
    expect(state.error).toBeNull()
    expect(state.steps).toEqual([])
    expect(state.governance.budget.filesTouched).toBe(0)
    expect(state.governance.budget.approvalsRequested).toBe(0)
    expect(state.governance.guardEnforcementMode).toBe("warn")
  })
})

describe("external status projection", () => {
  test("every internal status maps to a valid external one", () => {
    // toExternalStatus casts everything except compiled. If an internal status
    // were added without a matching external one, that cast would quietly
    // produce a value the external schema rejects.
    for (const status of ALL_STATUSES) {
      expect(() => RunStatusExternalSchema.parse(toExternalStatus(status))).not.toThrow()
    }
  })

  test("compiled is an internal-only detail presented as created", () => {
    expect(toExternalStatus("compiled")).toBe("created")
    expect(RunStatusExternalSchema.options).not.toContain("compiled" as never)
  })

  test("statuses other than compiled are passed through unchanged", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "compiled")) {
      expect(toExternalStatus(status)).toBe(status as never)
    }
  })
})

describe("step terminality", () => {
  test("blocked counts as terminal for a step even though it is not for a run", () => {
    // A blocked step is finished from the step machine's point of view; the run
    // it belongs to is very much not.
    expect(isStepTerminalStatus("blocked")).toBe(true)
    expect(isTerminalStatus("waiting_approval")).toBe(false)
  })

  test("in-flight step statuses are not terminal", () => {
    expect(isStepTerminalStatus("proposed")).toBe(false)
    expect(isStepTerminalStatus("running")).toBe(false)
  })
})
