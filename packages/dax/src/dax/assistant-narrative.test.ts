import { describe, expect, it } from "bun:test"
import { buildAssistantNarrative, classifyAssistantNarrativeIntensity } from "./assistant-narrative"

describe("assistant narrative contract", () => {
  it("keeps trivial chat direct and free of scaffolding", () => {
    const intensity = classifyAssistantNarrativeIntensity({
      asked: "hi",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: false,
      hasError: false,
      completed: true,
      doing: "Delivered an answer for this step.",
      next: "Continue with a follow-up request.",
    })
    expect(intensity).toBe("light")
    expect(
      buildAssistantNarrative({
        asked: "hi",
        mode: "plan",
        hasPendingTool: false,
        hasToolActivity: false,
        toolCount: 0,
        hasExecuteTool: false,
        hasVerifyTool: false,
        hasReasoning: false,
        hasError: false,
        completed: true,
        doing: "Delivered an answer for this step.",
        next: "Continue with a follow-up request.",
      }),
    ).toEqual({
      intensity: "light",
      showWorkingNote: false,
    })
  })

  it("keeps simple self-introduction prompts direct", () => {
    const narrative = buildAssistantNarrative({
      asked: "tell me about yourself",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("light")
    expect(narrative?.preamble).toBeUndefined()
    expect(narrative?.showWorkingNote).toBe(false)
  })

  it("keeps simple help prompts direct even when the model reasons briefly", () => {
    const narrative = buildAssistantNarrative({
      asked: "what can you do",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("light")
    expect(narrative?.preamble).toBeUndefined()
  })

  it("shows plan preamble for plan-mode turns regardless of request text", () => {
    const narrative = buildAssistantNarrative({
      asked: "can you review my repo",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Mapping the execution plan.")
  })

  it("shows plan preamble for release-readiness turns in plan mode", () => {
    const narrative = buildAssistantNarrative({
      asked: "lets plan the release readiness for DAX",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Mapping the execution plan.")
  })

  it("shows 'Plan ready.' when plan mode completes", () => {
    const narrative = buildAssistantNarrative({
      asked: "lets plan the release readiness for DAX",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: true,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Plan ready.")
  })

  it("shows audit preamble for audit-mode turns", () => {
    const narrative = buildAssistantNarrative({
      asked: "audit the repo for release",
      mode: "audit",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Reviewing for release risk.")
  })

  it("shows 'Audit complete.' when audit mode finishes", () => {
    const narrative = buildAssistantNarrative({
      asked: "audit the repo for release",
      mode: "audit",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: true,
      doing: "Audit complete.",
      next: "Review findings.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Audit complete.")
  })

  it("prioritises debug signal over mode when request is a debugging ask", () => {
    const narrative = buildAssistantNarrative({
      asked: "debug why streaming is broken in dax run",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Tracing the failure.")
  })

  it("returns 'Root cause identified.' when debug turn completes", () => {
    const narrative = buildAssistantNarrative({
      asked: "fix the failing test",
      mode: "build",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: true,
      doing: "Fixed.",
      next: "Done.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBe("Root cause identified.")
  })

  it("returns no preamble for generic build-mode asks without debug signal", () => {
    const narrative = buildAssistantNarrative({
      asked: "help me understand how DAX works",
      mode: "build",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBeUndefined()
  })

  it("returns no preamble for explore mode (stream speaks for itself)", () => {
    const narrative = buildAssistantNarrative({
      asked: "find all tsx files using useContext",
      mode: "explore",
      hasPendingTool: false,
      hasToolActivity: false,
      toolCount: 0,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: true,
      hasError: false,
      completed: true,
      doing: "Search complete.",
      next: "Done.",
    })
    expect(narrative?.intensity).toBe("guided")
    expect(narrative?.preamble).toBeUndefined()
  })

  it("keeps the structured execution card for tool-heavy work", () => {
    const narrative = buildAssistantNarrative({
      asked: "summarize this repository",
      mode: "plan",
      hasPendingTool: true,
      hasToolActivity: true,
      toolCount: 3,
      hasExecuteTool: false,
      hasVerifyTool: true,
      hasReasoning: true,
      hasError: false,
      completed: false,
      doing: "Executing the next step for your request.",
      next: "Wait for completion or press esc twice to stop.",
      liveStep: {
        now: "Reading the README to gather context.",
        next: "Next I will inspect the main entry points.",
      },
    })
    expect(narrative?.intensity).toBe("operational")
    expect(narrative?.step?.now).toContain("README")
    expect(narrative?.showWorkingNote).toBe(false)
  })

  it("downgrades small completed read-only turns to guided", () => {
    const intensity = classifyAssistantNarrativeIntensity({
      asked: "can you read my README",
      mode: "plan",
      hasPendingTool: false,
      hasToolActivity: true,
      toolCount: 1,
      hasExecuteTool: false,
      hasVerifyTool: false,
      hasReasoning: false,
      hasError: false,
      completed: true,
      doing: "Read the README.",
      next: "Answer directly.",
    })
    expect(intensity).toBe("guided")
  })
})
