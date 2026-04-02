import { describe, test, expect } from "bun:test"
import {
  createReflectionSummary,
  createHistoricalReflectionSummary,
  type ModelReflectionSummary,
} from "../../src/session/reflection-pruning"
import type { ExecutionReflection } from "../../src/session/state-types"

describe("reflection-pruning: createReflectionSummary", () => {
  const baseReflection: ExecutionReflection = {
    goal: "Implement user authentication",
    outcome_expected: "Users can login and logout",
    assumptions: ["User has email", "Passwords are hashed"],
    ambiguities: ["Should we support OAuth?"],
    risks: [{ level: "medium", item: "Token expiration", mitigation: "Use refresh tokens" }],
    alternatives: [{ id: "1", path: "OAuth only", tradeoff: "Simpler but less control" }],
    decision: "proceed",
    justification:
      "User authentication is a core feature required by the product roadmap. All security considerations have been addressed.",
    confidence: 0.85,
    requiresApproval: false,
    verificationPlan: ["Test login", "Test logout", "Test token refresh"],
    timestamp: "2024-01-01T00:00:00Z",
  }

  test("produces compact summary", () => {
    const summary = createReflectionSummary(baseReflection)

    expect(summary).toBeDefined()
    expect(summary!.goal).toBe("Implement user authentication")
    expect(summary!.decision).toBe("proceed")
    expect(summary!.requiresApproval).toBe(false)
    expect(summary!.justification_summary).toBeDefined()
  })

  test("truncates long goal", () => {
    const longGoalReflection = {
      ...baseReflection,
      goal: "A".repeat(300),
    }
    const summary = createReflectionSummary(longGoalReflection)

    expect(summary!.goal.length).toBeLessThanOrEqual(200)
    expect(summary!.goal.endsWith("...")).toBe(true)
  })

  test("truncates long justification", () => {
    const longJustificationReflection = {
      ...baseReflection,
      justification: "B".repeat(500),
    }
    const summary = createReflectionSummary(longJustificationReflection)

    expect(summary!.justification_summary!.length).toBeLessThanOrEqual(220)
  })

  test("handles missing justification", () => {
    const noJustificationReflection = {
      ...baseReflection,
      justification: undefined,
    }
    const summary = createReflectionSummary(noJustificationReflection)

    expect(summary!.justification_summary).toBeUndefined()
  })

  test("handles undefined reflection", () => {
    const summary = createReflectionSummary(undefined)

    expect(summary).toBeUndefined()
  })

  test("preserves decision enum", () => {
    const proceedReflection = { ...baseReflection, decision: "proceed" as const }
    const askReflection = { ...baseReflection, decision: "ask" as const }
    const stopReflection = { ...baseReflection, decision: "stop" as const }
    const branchReflection = { ...baseReflection, decision: "branch" as const }

    expect(createReflectionSummary(proceedReflection)!.decision).toBe("proceed")
    expect(createReflectionSummary(askReflection)!.decision).toBe("ask")
    expect(createReflectionSummary(stopReflection)!.decision).toBe("stop")
    expect(createReflectionSummary(branchReflection)!.decision).toBe("branch")
  })

  test("preserves requiresApproval boolean", () => {
    const requiresApprovalReflection = { ...baseReflection, requiresApproval: true }
    const noApprovalReflection = { ...baseReflection, requiresApproval: false }

    expect(createReflectionSummary(requiresApprovalReflection)!.requiresApproval).toBe(true)
    expect(createReflectionSummary(noApprovalReflection)!.requiresApproval).toBe(false)
  })
})

describe("reflection-pruning: createHistoricalReflectionSummary", () => {
  test("returns last 5 reflections", () => {
    const reflections: ExecutionReflection[] = Array.from({ length: 10 }, (_, i) => ({
      goal: `Goal ${i}`,
      outcome_expected: "Test",
      assumptions: [],
      ambiguities: [],
      risks: [],
      alternatives: [],
      decision: "proceed" as const,
      justification: `Justification ${i}`,
      confidence: 0.5,
      requiresApproval: false,
      verificationPlan: [],
      timestamp: new Date().toISOString(),
    }))

    const summary = createHistoricalReflectionSummary(reflections)

    expect(summary.length).toBe(5)
    expect(summary[0].goal).toBe("Goal 5")
    expect(summary[4].goal).toBe("Goal 9")
    expect(summary[4].confidence).toBe(0.5)
    expect(summary[4].timestamp).toBeDefined()
  })

  test("handles empty array", () => {
    const summary = createHistoricalReflectionSummary([])

    expect(summary).toEqual([])
  })

  test("handles array smaller than 5", () => {
    const reflections: ExecutionReflection[] = [
      {
        goal: "Goal 1",
        outcome_expected: "Test",
        assumptions: [],
        ambiguities: [],
        risks: [],
        alternatives: [],
        decision: "proceed" as const,
        justification: "Just 1",
        confidence: 0.5,
        requiresApproval: false,
        verificationPlan: [],
        timestamp: new Date().toISOString(),
      },
    ]

    const summary = createHistoricalReflectionSummary(reflections)

    expect(summary.length).toBe(1)
  })
})

describe("reflection-pruning: ModelReflectionSummary type", () => {
  test("has correct shape", () => {
    const summary: ModelReflectionSummary = {
      goal: "Test goal",
      decision: "proceed",
      justification_summary: "Test justification",
      requiresApproval: true,
    }

    expect(summary.goal).toBe("Test goal")
    expect(summary.decision).toBe("proceed")
    expect(summary.justification_summary).toBe("Test justification")
    expect(summary.requiresApproval).toBe(true)
  })

  test("justification_summary is optional", () => {
    const summary: ModelReflectionSummary = {
      goal: "Test goal",
      decision: "ask",
      requiresApproval: false,
    }

    expect(summary.justification_summary).toBeUndefined()
  })
})
