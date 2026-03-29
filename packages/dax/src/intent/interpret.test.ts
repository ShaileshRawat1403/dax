import { describe, it, expect } from "bun:test"
import { formatStructuredExecutionContract, refineIntent, interpretIntent, type IntentContext } from "./interpret"

describe("Intent Interpreter", () => {
  const mockContext: IntentContext = {
    cwd: "/mock/workspace/dir",
  }

  describe("refineIntent", () => {
    it("should return an exploration contract for 'explore' prompts", async () => {
      const result = await refineIntent("I want to explore the codebase", mockContext)
      expect(result!.goal).toBe("Understand the repository and answer: I want to explore the codebase")
      expect(result!.explicitConstraints).toContain("Read-only analysis preferred")
    })

    it("should treat 'know what my repo does' as exploration", async () => {
      const result = await refineIntent("I want to know what my repo does", mockContext)
      expect(result!.goal).toBe("Understand the repository and answer: I want to know what my repo does")
      expect(result!.formattedPrompt).toContain("## Execution Plan")
      expect(result!.formattedPrompt).toContain("## Success Criteria")
    })

    it("should return a basic contract for general prompts", async () => {
      const result = await refineIntent("Fix the build error in src/main.ts", mockContext)
      expect(result!.goal).toBe("Fix the reported issue: Fix the build error in src/main.ts")
      expect(result!.formattedPrompt).toContain("src/main.ts")
      expect(result!.formattedPrompt).toContain("## Execution Profile")
      expect(result!.formattedPrompt).toContain("## Likely Targets")
      expect(result!.formattedPrompt).toContain("## Likely Writes")
      expect(result!.formattedPrompt).toContain("## Approval Forecast")
      expect(result!.formattedPrompt).toContain("## Unknowns & Assumptions")
      expect(result!.formattedPrompt).toContain("## Rollback & Recovery")
      expect(result!.targetFiles).toContain("src/main.ts")
      expect(result!.formattedPrompt).toContain("## Validation Commands")
      expect(result!.successCriteria).toContain("The reported failure is resolved in a reproducible way")
      expect(result!.explicitConstraints).toContain("Minimize the change surface until the root cause is confirmed")
      expect(result!.likelyWrites).toContain("src/main.ts")
      expect(result!.approvalForecast?.length).toBeGreaterThan(0)
    })

    it("should omit constraints section when fallback has no constraints", async () => {
      const formatted = formatStructuredExecutionContract({
        goal: "Do something useful",
        plan: ["Inspect the current state", "Make the smallest needed change"],
        successCriteria: ["The request is completed"],
        constraints: [],
      })
      expect(formatted).not.toContain("## Constraints & Requirements")
      expect(formatted).toContain("## Goal")
      expect(formatted).toContain("## Execution Plan")
    })

    it("should add a repository boundary constraint to default fallback contracts", async () => {
      const result = await refineIntent("Do something random", mockContext)
      expect(result!.explicitConstraints).toContain("Stay within the active repository at /mock/workspace/dir")
      expect(result!.formattedPrompt).toContain("Stay within the active repository at /mock/workspace/dir")
    })

    it("should include session-aware context and watchouts in fallback contracts", async () => {
      const result = await refineIntent("Prepare a release readiness assessment", {
        ...mockContext,
        session_title: "Release readiness review",
        current_focus: "Inspecting release scripts",
        todo: ["inspect release workflow", "verify docs", "check git state"],
        recent_activity: ["reviewing package.json", "checking release scripts"],
        pending_approvals: 1,
        audit_status: "warn",
      })

      expect(result!.contextSignals).toContain("Current session goal: Release readiness review")
      expect(result!.contextSignals).toContain("Current focus: Inspecting release scripts")
      expect(result!.formattedPrompt).toContain("## Session Context")
      expect(result!.formattedPrompt).toContain("Known milestones: inspect release workflow | verify docs | check git state")
      expect(result!.operatorWatchouts).toContain("There is 1 pending approval that may block execution.")
      expect(result!.formattedPrompt).toContain("## Operator Watchouts")
      expect(result!.formattedPrompt).toContain("Audit posture is warning. Prefer smaller changes and explicit verification.")
      expect(result!.executionMode).toBe("safe")
      expect(result!.approvalForecast).toContain(
        "Existing pending approvals may need resolution before this run can continue smoothly.",
      )
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
