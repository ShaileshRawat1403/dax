import { describe, expect, test } from "bun:test"
import { deriveWorkstationState } from "./workstation"
import type { ExecutionReflection } from "@/session/state-types"

describe("reflection flow dummy run", () => {
  test("derives workstation state with formal reflection data", () => {
    const dummyReflection: ExecutionReflection = {
      goal: "Refactor the TUI components for better observability",
      outcome_expected: "Cleaner separation of narrative, state, and evidence channels",
      assumptions: [
        "The user wants a professional operator workstation feel",
        "The current TUI is Solid-JS based"
      ],
      ambiguities: ["Exact layout of the right drawer is flexible"],
      risks: [
        { level: "low", item: "Visual noise from too much reflection data", mitigation: "Use a dedicated toggleable panel" }
      ],
      alternatives: [
        { id: "alt-1", path: "inline-reflection", tradeoff: "Easier to see but clutters the transcript" }
      ],
      decision: "proceed",
      confidence: 0.95,
      requiresApproval: false,
      verificationPlan: [
        "Check that reflection panel renders correctly",
        "Verify persona switching works"
      ],
      timestamp: new Date().toISOString()
    }

    const state = deriveWorkstationState({
      sessionID: "dummy-reflection-run",
      stage: "planning",
      stageReason: "critiquing the proposed architecture",
      sessionStatusType: "busy",
      goal: "Upgrade DAX TUI",
      todo: [
        { content: "Implement ReflectionPanel", status: "in_progress" },
        { content: "Add Persona system", status: "pending" }
      ],
      approvals: [],
      questions: 0,
      artifacts: [],
      diffCount: 5,
      reflection: dummyReflection,
      recentTooling: [{ label: "edit · workstation.ts", status: "completed" }]
    })

    console.log("\n--- DUMMY RUN WORKSTATION STATE ---")
    console.log("Session ID:", state.sessionID)
    console.log("Lifecycle:", state.lifecycle)
    console.log("Phase:", state.phase)
    console.log("Reflection Goal:", state.reflection?.goal)
    console.log("Reflection Confidence:", state.reflection?.confidence)
    console.log("Next Move:", state.reflection?.decision)
    console.log("-----------------------------------\n")

    expect(state.reflection).toBeDefined()
    expect(state.reflection?.goal).toBe(dummyReflection.goal)
    expect(state.reflection?.confidence).toBe(0.95)
    expect(state.lifecycle).toBe("planning")
  })
})
