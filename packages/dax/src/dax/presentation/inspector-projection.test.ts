import { describe, expect, test } from "bun:test"
import {
  isInspectorAutoOpenRequired,
  requiredPaneModeForInspector,
} from "./inspector-projection"
import {
  resolveUIState,
  type ActiveUIState,
  type InspectorProjection,
  type InspectorState,
} from "./ui-state-resolver"

function inspector(state: InspectorState, overrides: Partial<InspectorProjection> = {}): InspectorProjection {
  if (state === "closed") {
    return { state: "closed", requiresFocusTrap: false, ...overrides }
  }
  return {
    state,
    requiresFocusTrap: true,
    openedBy: "test",
    content: "test",
    ...overrides,
  }
}

function active(overrides: Partial<ActiveUIState> = {}): ActiveUIState {
  return {
    run: "ready",
    user: null,
    environment: { provider: "healthy", mcp: "healthy", lsp: "healthy" },
    safety: [],
    focus: "none",
    ...overrides,
  }
}

describe("isInspectorAutoOpenRequired", () => {
  test("closed inspector does not require auto-open", () => {
    expect(isInspectorAutoOpenRequired(inspector("closed"))).toBe(false)
  })

  test("every non-closed state requires auto-open", () => {
    const states: InspectorState[] = ["approval_card", "question_card", "safety_block", "auth_required"]
    for (const state of states) {
      expect(isInspectorAutoOpenRequired(inspector(state))).toBe(true)
    }
  })
})

describe("requiredPaneModeForInspector", () => {
  test("closed → null", () => {
    expect(requiredPaneModeForInspector(inspector("closed"))).toBeNull()
  })

  test("approval_card → approvals", () => {
    expect(requiredPaneModeForInspector(inspector("approval_card"))).toBe("approvals")
  })

  test("question_card → approvals", () => {
    expect(requiredPaneModeForInspector(inspector("question_card"))).toBe("approvals")
  })

  test("safety_block → approvals", () => {
    expect(requiredPaneModeForInspector(inspector("safety_block"))).toBe("approvals")
  })

  test("auth_required → approvals", () => {
    expect(requiredPaneModeForInspector(inspector("auth_required"))).toBe("approvals")
  })
})

describe("end-to-end: resolver → inspector projection → pane decisions", () => {
  test("waiting_for_approval pipeline opens approvals pane", () => {
    const projection = resolveUIState(active({ user: "waiting_for_approval" }), 1_000, null)
    expect(projection.inspector.state).toBe("approval_card")
    expect(isInspectorAutoOpenRequired(projection.inspector)).toBe(true)
    expect(requiredPaneModeForInspector(projection.inspector)).toBe("approvals")
  })

  test("waiting_for_answer pipeline opens approvals pane", () => {
    const projection = resolveUIState(active({ user: "waiting_for_answer" }), 1_000, null)
    expect(projection.inspector.state).toBe("question_card")
    expect(isInspectorAutoOpenRequired(projection.inspector)).toBe(true)
    expect(requiredPaneModeForInspector(projection.inspector)).toBe("approvals")
  })

  test("policy_blocked pipeline opens approvals pane (no dedicated safety pane in v0.1)", () => {
    const projection = resolveUIState(active({ safety: ["policy_blocked"] }), 1_000, null)
    expect(projection.inspector.state).toBe("safety_block")
    expect(isInspectorAutoOpenRequired(projection.inspector)).toBe(true)
    expect(requiredPaneModeForInspector(projection.inspector)).toBe("approvals")
  })

  test("auth_required pipeline opens approvals pane", () => {
    const projection = resolveUIState(active({ safety: ["auth_required"] }), 1_000, null)
    expect(projection.inspector.state).toBe("auth_required")
    expect(isInspectorAutoOpenRequired(projection.inspector)).toBe(true)
    expect(requiredPaneModeForInspector(projection.inspector)).toBe("approvals")
  })

  test("working state does not force open", () => {
    const projection = resolveUIState(active({ run: "working" }), 1_000, null)
    expect(projection.inspector.state).toBe("closed")
    expect(isInspectorAutoOpenRequired(projection.inspector)).toBe(false)
    expect(requiredPaneModeForInspector(projection.inspector)).toBeNull()
  })

  test("safety wins over user state: auth + approval still routes to approvals", () => {
    const projection = resolveUIState(
      active({ user: "waiting_for_approval", safety: ["auth_required"] }),
      1_000,
      null,
    )
    expect(projection.inspector.state).toBe("auth_required")
    expect(requiredPaneModeForInspector(projection.inspector)).toBe("approvals")
  })
})
