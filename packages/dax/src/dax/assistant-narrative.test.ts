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

  it("adapts guided preambles to repo review work", () => {
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
    expect(narrative?.preamble).toContain("repo safely")
  })

  it("drops meta preambles for direct docs asks", () => {
    const narrative = buildAssistantNarrative({
      asked: "review this repo readme",
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
    expect(narrative?.preamble).toBeUndefined()
  })

  it("adapts guided preambles to release-readiness work", () => {
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
    expect(narrative?.preamble).toContain("release surface")
  })

  it("adapts guided preambles to streaming UX work", () => {
    const narrative = buildAssistantNarrative({
      asked: "i want to check the model streaming",
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
    expect(narrative?.preamble).toContain("streaming path")
  })

  it("adapts guided preambles to architecture review work", () => {
    const narrative = buildAssistantNarrative({
      asked: "explain the dax architecture and orchestration flow",
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
    expect(narrative?.preamble).toContain("system boundaries")
  })

  it("adapts guided preambles to debugging work", () => {
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
    expect(narrative?.preamble).toContain("failure boundary")
  })

  it("adapts guided preambles to learning-oriented prompts", () => {
    const narrative = buildAssistantNarrative({
      asked: "help me understand how DAX works",
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
    expect(narrative?.preamble).toContain("why it matters")
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
