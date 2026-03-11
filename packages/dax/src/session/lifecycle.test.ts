import { describe, expect, test } from "bun:test"
import { deriveSessionLifecycleFromMessages } from "./lifecycle"

describe("session lifecycle derivation", () => {
  test("keeps lightweight visible-answer runs active with reconciliation required", () => {
    const lifecycle = deriveSessionLifecycleFromMessages({
      pendingApprovalCount: 0,
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", finish: "stop", time: { created: 2, completed: 3 } },
          parts: [{ type: "text" }, { type: "step-finish" }],
        },
      ] as any,
    })

    expect(lifecycle.lifecycle_state).toBe("active")
    expect(lifecycle.terminal).toBe(false)
    expect(lifecycle.requires_reconciliation).toBe(true)
  })

  test("keeps planning-like terminal runs completed", () => {
    const lifecycle = deriveSessionLifecycleFromMessages({
      pendingApprovalCount: 0,
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", finish: "tool-calls", time: { created: 2, completed: 3 } },
          parts: [{ type: "tool", state: { status: "completed" } }, { type: "step-finish" }],
        },
        {
          info: { role: "assistant", finish: "stop", time: { created: 4, completed: 5 } },
          parts: [{ type: "text" }, { type: "step-finish" }],
        },
      ] as any,
    })

    expect(lifecycle.lifecycle_state).toBe("completed")
    expect(lifecycle.terminal).toBe(true)
  })

  test("promotes strong artifact-heavy tool execution to completed without a final stop message", () => {
    const lifecycle = deriveSessionLifecycleFromMessages({
      pendingApprovalCount: 0,
      retainedArtifactCount: 2,
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", finish: "tool-calls", time: { created: 2, completed: 3 } },
          parts: [{ type: "tool", state: { status: "completed" } }, { type: "step-finish" }],
        },
        {
          info: { role: "assistant", finish: "tool-calls", time: { created: 4, completed: 5 } },
          parts: [{ type: "tool", state: { status: "completed" } }, { type: "step-finish" }],
        },
      ] as any,
    })

    expect(lifecycle.lifecycle_state).toBe("completed")
    expect(lifecycle.terminal).toBe(true)
    expect(lifecycle.requires_reconciliation).toBe(false)
  })

  test("marks unrecovered assistant errors as terminal failed lifecycle", () => {
    const lifecycle = deriveSessionLifecycleFromMessages({
      pendingApprovalCount: 0,
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text" }],
        },
        {
          info: { role: "assistant", error: { name: "APIError" }, time: { created: 2 } },
          parts: [{ type: "step-start" }],
        },
      ] as any,
    })

    expect(lifecycle.lifecycle_state).toBe("failed")
    expect(lifecycle.terminal).toBe(true)
    expect(lifecycle.requires_reconciliation).toBe(false)
  })
})
