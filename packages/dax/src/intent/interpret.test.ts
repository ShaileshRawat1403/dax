import { describe, it, expect } from "bun:test"
import { refineIntent, interpretIntent, type IntentContext } from "./interpret"

describe("Intent Interpreter", () => {
  const mockContext: IntentContext = {
    cwd: "/mock/workspace/dir",
  }

  describe("refineIntent", () => {
    it("should return an exploration contract for 'explore' prompts", async () => {
      const result = await refineIntent("I want to explore the codebase", mockContext)
      expect(result.goal).toBe("Map repository structure and understand core logic")
      expect(result.explicitConstraints).toContain("Read-only access preferred")
    })

    it("should return a basic contract for general prompts", async () => {
      const result = await refineIntent("Fix the build error in src/main.ts", mockContext)
      expect(result.goal).toBe("Fix the build error in src/main.ts")
      expect(result.successCriteria).toContain("Task completed as described")
      expect(result.explicitConstraints).toBeEmpty()
    })
  })

  describe("interpretIntent", () => {
    it("should correctly route to the 'explore_repo' intent", async () => {
      const result = await interpretIntent("Please help me understand this repo", mockContext)
      expect(result.intentType).toBe("explore_repo")
      expect(result.suggestedOperator).toBe("explore")
      expect(result.requiredSkills).toContain("repo-explore")
    })

    it("should correctly route to the 'git_review' intent", async () => {
      const result = await interpretIntent("Review this pull request", mockContext)
      expect(result.intentType).toBe("git_review")
      expect(result.suggestedOperator).toBe("git")
      expect(result.requiredSkills).toContain("git-review")
    })

    it("should correctly route to the 'verify_session' intent", async () => {
      const result = await interpretIntent("Can we verify the changes?", mockContext)
      expect(result.intentType).toBe("verify_session")
      expect(result.suggestedOperator).toBe("verify")
      expect(result.requiredSkills).toContain("trust-verify")
    })

    it("should correctly route to the 'release_readiness' intent", async () => {
      const result = await interpretIntent("Are we ready to ship this?", mockContext)
      expect(result.intentType).toBe("release_readiness")
      expect(result.suggestedOperator).toBe("release")
      expect(result.requiredSkills).toContain("release-readiness")
    })

    it("should fallback to 'general_query' for unmatched intents", async () => {
      const result = await interpretIntent("Write a new utility function", mockContext)
      expect(result.intentType).toBe("general_query")
      expect(result.suggestedOperator).toBe("general")
      expect(result.requiredSkills).toBeEmpty()
      expect(result.confidence).toBe(0.85)
      expect(result.activeMode).toBe("execute")
    })
  })
})
