import { describe, expect, test } from "bun:test"
import {
  assertResolvedUIStateInvariants,
  IDLE_ACTIVE_UI_STATE,
  IDLE_UI_PROJECTION,
  resolveUIState,
  type ActiveUIState,
  type InspectorState,
  type ResolvedUISurface,
} from "./ui-state-resolver"

function active(overrides: Partial<ActiveUIState> = {}): ActiveUIState {
  return {
    ...IDLE_ACTIVE_UI_STATE,
    ...overrides,
    environment: {
      ...IDLE_ACTIVE_UI_STATE.environment,
      ...overrides.environment,
    },
    safety: overrides.safety ?? IDLE_ACTIVE_UI_STATE.safety,
  }
}

describe("resolveUIState", () => {
  describe("safety wins everything", () => {
    test("policy_blocked wins over auth, failure, user, and run state", () => {
      const projection = resolveUIState(
        active({
          run: "failed",
          user: "waiting_for_approval",
          safety: ["auth_required", "policy_blocked"],
        }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("policy_blocked")
      expect(projection.header.winner).toBe("safety.policy_blocked")
      expect(projection.header.priority).toBe(1)
      expect(projection.header.requiresAction).toBe(true)
      expect(projection.inspector.state).toBe("safety_block")
      expect(projection.inspector.requiresFocusTrap).toBe(true)
      expect(projection.inspector.openedBy).toBe("safety.policy_blocked")
    })

    test("auth_required wins when policy block is absent", () => {
      const projection = resolveUIState(
        active({
          run: "failed",
          user: "waiting_for_approval",
          safety: ["auth_required"],
        }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("auth_required")
      expect(projection.header.winner).toBe("safety.auth_required")
      expect(projection.inspector.state).toBe("auth_required")
      expect(projection.inspector.requiresFocusTrap).toBe(true)
    })

    test("safety array order does not affect resolution", () => {
      const a = resolveUIState(active({ safety: ["policy_blocked", "auth_required"] }), 1_000, null)
      const b = resolveUIState(active({ safety: ["auth_required", "policy_blocked"] }), 1_000, null)
      expect(a.header.state).toBe(b.header.state)
      expect(a.header.winner).toBe(b.header.winner)
    })
  })

  describe("failure wins over user and run state when no safety is active", () => {
    test("failed beats waiting_for_approval", () => {
      const projection = resolveUIState(
        active({ run: "failed", user: "waiting_for_approval", safety: [] }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("failed")
      expect(projection.header.winner).toBe("run.failed")
      expect(projection.header.requiresAction).toBe(false)
      expect(projection.inspector.state).toBe("closed")
    })

    test("failed beats working", () => {
      const projection = resolveUIState(
        active({ run: "failed", safety: [] }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("failed")
    })
  })

  describe("user state wins over run state", () => {
    test("waiting_for_approval beats cooling_down", () => {
      const projection = resolveUIState(
        active({ run: "cooling_down", user: "waiting_for_approval" }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("waiting_for_approval")
      expect(projection.header.priority).toBe(4)
      expect(projection.inspector.state).toBe("approval_card")
      expect(projection.inspector.openedBy).toBe("user.waiting_for_approval")
    })

    test("waiting_for_answer beats working", () => {
      const projection = resolveUIState(
        active({ run: "working", user: "waiting_for_answer" }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("waiting_for_answer")
      expect(projection.inspector.state).toBe("question_card")
    })

    test("approval beats answer when both are somehow active in label priority", () => {
      // The producer guarantees user is single-valued, but the priority ladder
      // is still spec'd so approval > answer if a future producer ever stacks.
      const approval = resolveUIState(active({ user: "waiting_for_approval" }), 1_000, null)
      const answer = resolveUIState(active({ user: "waiting_for_answer" }), 1_000, null)
      expect(approval.header.priority).toBeLessThan(answer.header.priority)
    })
  })

  describe("run state ladder", () => {
    test("cooling_down beats working", () => {
      const cd = resolveUIState(active({ run: "cooling_down" }), 1_000, null)
      const w = resolveUIState(active({ run: "working" }), 1_000, null)
      expect(cd.header.priority).toBeLessThan(w.header.priority)
    })

    test("provider_delayed beats compacting", () => {
      const pd = resolveUIState(active({ run: "provider_delayed" }), 1_000, null)
      const c = resolveUIState(active({ run: "compacting" }), 1_000, null)
      expect(pd.header.priority).toBeLessThan(c.header.priority)
    })

    test("each run state produces the expected header label", () => {
      expect(resolveUIState(active({ run: "working" }), 0, null).header.label).toBe("DAX · Working")
      expect(resolveUIState(active({ run: "cooling_down" }), 0, null).header.label).toBe(
        "DAX · Cooling down",
      )
      expect(resolveUIState(active({ run: "provider_delayed" }), 0, null).header.label).toBe(
        "DAX · Provider delayed",
      )
      expect(resolveUIState(active({ run: "compacting" }), 0, null).header.label).toBe(
        "DAX · Compacting context",
      )
      expect(resolveUIState(active({ run: "resuming" }), 0, null).header.label).toBe(
        "DAX · Resuming",
      )
      expect(resolveUIState(active({ run: "ready" }), 0, null).header.label).toBe("DAX · Ready")
    })
  })

  describe("complete decays to ready after 3s", () => {
    test("first sight of complete anchors completedAt at now", () => {
      const projection = resolveUIState(active({ run: "complete" }), 1_000, null)
      expect(projection.header.state).toBe("complete")
      expect(projection.header.completedAt).toBe(1_000)
    })

    test("complete persists at 2999ms after first sight", () => {
      const previous = resolveUIState(active({ run: "complete" }), 1_000, null)
      const projection = resolveUIState(active({ run: "complete" }), 3_999, previous)
      expect(projection.header.state).toBe("complete")
      expect(projection.header.completedAt).toBe(1_000)
    })

    test("complete decays to ready at exactly 3000ms", () => {
      const previous = resolveUIState(active({ run: "complete" }), 1_000, null)
      const projection = resolveUIState(active({ run: "complete" }), 4_000, previous)
      expect(projection.header.state).toBe("ready")
      expect(projection.header.winner).toBe("run.complete.decayed")
      expect(projection.header.completedAt).toBeUndefined()
    })

    test("higher-priority states override complete during its decay window", () => {
      const previous = resolveUIState(active({ run: "complete" }), 1_000, null)
      const projection = resolveUIState(
        active({ run: "complete", user: "waiting_for_approval" }),
        2_000,
        previous,
      )
      expect(projection.header.state).toBe("waiting_for_approval")
      expect(projection.inspector.state).toBe("approval_card")
    })

    test("decay anchor survives re-resolution while complete keeps winning", () => {
      const t0 = resolveUIState(active({ run: "complete" }), 1_000, null)
      const t1 = resolveUIState(active({ run: "complete" }), 2_000, t0)
      const t2 = resolveUIState(active({ run: "complete" }), 2_500, t1)
      expect(t1.header.completedAt).toBe(1_000)
      expect(t2.header.completedAt).toBe(1_000)
    })

    test("decay window restarts if complete is interrupted and re-entered", () => {
      const first = resolveUIState(active({ run: "complete" }), 1_000, null)
      const interrupted = resolveUIState(
        active({ run: "complete", user: "waiting_for_approval" }),
        2_000,
        first,
      )
      const reentered = resolveUIState(active({ run: "complete" }), 3_000, interrupted)
      expect(interrupted.header.state).toBe("waiting_for_approval")
      // Previous header was waiting_for_approval, so completedAt resets.
      expect(reentered.header.state).toBe("complete")
      expect(reentered.header.completedAt).toBe(3_000)
    })
  })

  describe("idle projection on first resolve", () => {
    test("idle inputs with null previous produce ready/closed/healthy", () => {
      const projection = resolveUIState(IDLE_ACTIVE_UI_STATE, 0, null)
      expect(projection.header.state).toBe("ready")
      expect(projection.header.label).toBe("DAX · Ready")
      expect(projection.header.requiresAction).toBe(false)
      expect(projection.inspector.state).toBe("closed")
      expect(projection.inspector.requiresFocusTrap).toBe(false)
      expect(projection.inspector.content).toBeUndefined()
      expect(projection.footer.health).toBe("healthy")
      expect(projection.footer.label).toBe("● Env")
    })

    test("IDLE_UI_PROJECTION matches a fresh resolve of IDLE_ACTIVE_UI_STATE", () => {
      const fresh = resolveUIState(IDLE_ACTIVE_UI_STATE, 0, null)
      expect(IDLE_UI_PROJECTION).toEqual(fresh)
    })
  })

  describe("environment health collapses to a footer dot", () => {
    test("all healthy produces healthy footer with no reason", () => {
      const projection = resolveUIState(
        active({ environment: { provider: "healthy", mcp: "healthy", lsp: "healthy" } }),
        1_000,
        null,
      )
      expect(projection.footer.health).toBe("healthy")
      expect(projection.footer.label).toBe("● Env")
      expect(projection.footer.reason).toBeUndefined()
    })

    test("single degraded service produces degraded footer", () => {
      const projection = resolveUIState(
        active({ environment: { provider: "healthy", mcp: "degraded", lsp: "healthy" } }),
        1_000,
        null,
      )
      expect(projection.footer.health).toBe("degraded")
      expect(projection.footer.reason).toBe("mcp degraded")
    })

    test("unavailable beats degraded", () => {
      const projection = resolveUIState(
        active({ environment: { provider: "degraded", mcp: "unavailable", lsp: "healthy" } }),
        1_000,
        null,
      )
      expect(projection.footer.health).toBe("unavailable")
      expect(projection.footer.reason).toBe("mcp unavailable")
    })

    test("footer reason follows fixed service iteration order: provider, mcp, lsp", () => {
      const allDegraded = resolveUIState(
        active({ environment: { provider: "degraded", mcp: "degraded", lsp: "degraded" } }),
        1_000,
        null,
      )
      expect(allDegraded.footer.reason).toBe("provider degraded")

      const mcpAndLsp = resolveUIState(
        active({ environment: { provider: "healthy", mcp: "degraded", lsp: "degraded" } }),
        1_000,
        null,
      )
      expect(mcpAndLsp.footer.reason).toBe("mcp degraded")

      const lspOnly = resolveUIState(
        active({ environment: { provider: "healthy", mcp: "healthy", lsp: "degraded" } }),
        1_000,
        null,
      )
      expect(lspOnly.footer.reason).toBe("lsp degraded")
    })

    test("footer.services preserves per-service detail even when collapsed", () => {
      const projection = resolveUIState(
        active({ environment: { provider: "healthy", mcp: "degraded", lsp: "unavailable" } }),
        1_000,
        null,
      )
      expect(projection.footer.health).toBe("unavailable")
      expect(projection.footer.services).toEqual({
        provider: "healthy",
        mcp: "degraded",
        lsp: "unavailable",
      })
    })
  })

  describe("focus does not affect header, inspector, or footer", () => {
    test("changing focus alone produces equal projections", () => {
      const states: Array<ActiveUIState["focus"]> = ["none", "transcript", "input", "inspector"]
      const projections = states.map((focus) =>
        resolveUIState(active({ run: "working", focus }), 1_000, null),
      )
      const reference = projections[0]!
      for (const p of projections) {
        expect(p).toEqual(reference)
      }
    })
  })

  describe("contradictory inputs resolve by ladder, not by rejection", () => {
    test("complete plus waiting_for_approval resolves to waiting_for_approval", () => {
      const projection = resolveUIState(
        active({ run: "complete", user: "waiting_for_approval" }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("waiting_for_approval")
      expect(projection.header.priority).toBe(4)
    })

    test("failed plus auth_required resolves to auth_required", () => {
      const projection = resolveUIState(
        active({ run: "failed", safety: ["auth_required"] }),
        1_000,
        null,
      )
      expect(projection.header.state).toBe("auth_required")
    })
  })

  describe("determinism", () => {
    test("same inputs always produce equal outputs", () => {
      const input = active({ run: "cooling_down", user: "waiting_for_approval", safety: [] })
      const a = resolveUIState(input, 1_000, null)
      const b = resolveUIState(input, 1_000, null)
      expect(a).toEqual(b)
    })

    test("now is the only source of time; resolver never reads the clock", () => {
      // If resolver read Date.now() internally, two resolves at different
      // wall-clock moments with the same `now` argument would diverge.
      const input = active({ run: "complete" })
      const a = resolveUIState(input, 5_000, null)
      // simulate wall-clock advancing while we re-resolve with the same `now`
      const b = resolveUIState(input, 5_000, null)
      expect(a).toEqual(b)
    })
  })

  describe("requiresAction matches contract", () => {
    test("safety and user states require action", () => {
      const cases: Array<[ActiveUIState, boolean]> = [
        [active({ safety: ["policy_blocked"] }), true],
        [active({ safety: ["auth_required"] }), true],
        [active({ user: "waiting_for_approval" }), true],
        [active({ user: "waiting_for_answer" }), true],
        [active({ run: "failed" }), false],
        [active({ run: "cooling_down" }), false],
        [active({ run: "working" }), false],
        [active({ run: "ready" }), false],
      ]
      for (const [input, expected] of cases) {
        expect(resolveUIState(input, 1_000, null).header.requiresAction).toBe(expected)
      }
    })
  })

  describe("inspector auto-opens only for safety and user states", () => {
    test("non-action states leave inspector closed", () => {
      const runs: Array<ActiveUIState["run"]> = [
        "ready",
        "working",
        "cooling_down",
        "provider_delayed",
        "compacting",
        "resuming",
        "failed",
      ]
      for (const run of runs) {
        const projection = resolveUIState(active({ run }), 1_000, null)
        expect(projection.inspector.state).toBe("closed")
        expect(projection.inspector.requiresFocusTrap).toBe(false)
        expect(projection.inspector.content).toBeUndefined()
      }
    })

    test("every safety and user state opens a focus-trapping inspector", () => {
      const cases: Array<[ActiveUIState, InspectorState]> = [
        [active({ safety: ["policy_blocked"] }), "safety_block"],
        [active({ safety: ["auth_required"] }), "auth_required"],
        [active({ user: "waiting_for_approval" }), "approval_card"],
        [active({ user: "waiting_for_answer" }), "question_card"],
      ]
      for (const [input, expectedState] of cases) {
        const projection = resolveUIState(input, 1_000, null)
        expect(projection.inspector.state).toBe(expectedState)
        expect(projection.inspector.requiresFocusTrap).toBe(true)
        expect(projection.inspector.content).toBeDefined()
        expect(projection.inspector.openedBy).toBeDefined()
      }
    })
  })

  describe("invariants", () => {
    test("every projection produced by resolver passes invariants", () => {
      const cases: ActiveUIState[] = [
        IDLE_ACTIVE_UI_STATE,
        active({ run: "working" }),
        active({ run: "cooling_down", user: "waiting_for_approval" }),
        active({ run: "failed" }),
        active({ run: "complete" }),
        active({ safety: ["policy_blocked", "auth_required"] }),
        active({ environment: { provider: "unavailable", mcp: "degraded", lsp: "healthy" } }),
      ]
      for (const input of cases) {
        const projection = resolveUIState(input, 1_000, null)
        expect(() => assertResolvedUIStateInvariants(projection)).not.toThrow()
      }
    })

    test("closed inspector with content fails invariant", () => {
      const invalid: ResolvedUISurface = {
        header: {
          state: "ready",
          label: "DAX · Ready",
          requiresAction: false,
          winner: "run.ready",
          priority: 12,
        },
        inspector: { state: "closed", requiresFocusTrap: false, content: "approval" },
        footer: {
          health: "healthy",
          label: "● Env",
          services: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
        },
      }
      expect(() => assertResolvedUIStateInvariants(invalid)).toThrow(
        "closed inspector cannot have content",
      )
    })

    test("requiresAction with closed inspector fails invariant", () => {
      const invalid: ResolvedUISurface = {
        header: {
          state: "waiting_for_approval",
          label: "DAX · Waiting for you",
          requiresAction: true,
          winner: "user.waiting_for_approval",
          priority: 4,
        },
        inspector: { state: "closed", requiresFocusTrap: false },
        footer: {
          health: "healthy",
          label: "● Env",
          services: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
        },
      }
      expect(() => assertResolvedUIStateInvariants(invalid)).toThrow(
        "required action must open inspector",
      )
    })

    test("closed inspector trapping focus fails invariant", () => {
      const invalid: ResolvedUISurface = {
        header: {
          state: "ready",
          label: "DAX · Ready",
          requiresAction: false,
          winner: "run.ready",
          priority: 12,
        },
        inspector: { state: "closed", requiresFocusTrap: true },
        footer: {
          health: "healthy",
          label: "● Env",
          services: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
        },
      }
      expect(() => assertResolvedUIStateInvariants(invalid)).toThrow(
        "closed inspector cannot trap focus",
      )
    })

    test("complete header without completedAt fails invariant", () => {
      const invalid: ResolvedUISurface = {
        header: {
          state: "complete",
          label: "DAX · Complete",
          requiresAction: false,
          winner: "run.complete",
          priority: 11,
        },
        inspector: { state: "closed", requiresFocusTrap: false },
        footer: {
          health: "healthy",
          label: "● Env",
          services: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
        },
      }
      expect(() => assertResolvedUIStateInvariants(invalid)).toThrow(
        "complete header must record completedAt",
      )
    })

    test("non-complete header carrying completedAt fails invariant", () => {
      const invalid: ResolvedUISurface = {
        header: {
          state: "ready",
          label: "DAX · Ready",
          requiresAction: false,
          winner: "run.ready",
          priority: 12,
          completedAt: 1_000,
        },
        inspector: { state: "closed", requiresFocusTrap: false },
        footer: {
          health: "healthy",
          label: "● Env",
          services: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
        },
      }
      expect(() => assertResolvedUIStateInvariants(invalid)).toThrow(
        "completedAt is only valid on complete header",
      )
    })
  })
})
