import type { IntentEnvelope, IntentType } from "./types"

export interface IntentContext {
  cwd: string
  session_id?: string
  recent_history?: string[]
}

/**
 * Refine a raw user prompt into a structured Execution Contract.
 * This ensures the AI understands success criteria and constraints.
 */
export async function refineIntent(prompt: string, context: IntentContext): Promise<IntentEnvelope["contract"]> {
  // TODO: Implement LLM call to refine raw input into a structured contract.
  // For now, return a basic heuristic contract based on common patterns.
  
  const lowerPrompt = prompt.toLowerCase()
  
  if (lowerPrompt.includes("explore") || lowerPrompt.includes("understand")) {
    return {
      goal: "Map repository structure and understand core logic",
      successCriteria: ["File tree mapped", "Entry points identified", "Key dependencies listed"],
      explicitConstraints: ["Read-only access preferred"],
    }
  }

  return {
    goal: prompt,
    successCriteria: ["Task completed as described"],
    explicitConstraints: [],
  }
}

/**
 * Interpret a raw user prompt into a structured intent envelope.
 * Coordinates between raw input refinement and intent classification.
 */
export async function interpretIntent(prompt: string, context: IntentContext): Promise<IntentEnvelope> {
  const contract = await refineIntent(prompt, context)
  
  // Heuristic routing (eventually LLM-backed)
  const lowerPrompt = prompt.toLowerCase()
  let intentType: IntentType = "general_query"
  let suggestedOperator = "general"
  let requiredSkills: string[] = []

  if (lowerPrompt.includes("explore") || lowerPrompt.includes("understand this repo")) {
    intentType = "explore_repo"
    suggestedOperator = "explore"
    requiredSkills = ["repo-explore"]
  } else if (
    lowerPrompt.includes("review") &&
    (lowerPrompt.includes("pr") || lowerPrompt.includes("pull request") || lowerPrompt.includes("diff"))
  ) {
    intentType = "git_review"
    suggestedOperator = "git"
    requiredSkills = ["git-review"]
  } else if (lowerPrompt.includes("verify") || lowerPrompt.includes("trust")) {
    intentType = "verify_session"
    suggestedOperator = "verify"
    requiredSkills = ["trust-verify"]
  } else if (lowerPrompt.includes("release") || lowerPrompt.includes("ready to ship")) {
    intentType = "release_readiness"
    suggestedOperator = "release"
    requiredSkills = ["release-readiness"]
  }

  return {
    intentType,
    confidence: 0.85,
    activeMode: "execute",
    suggestedOperator,
    requiredSkills,
    requestedOutput: "narrative",
    riskLevel: "medium",
    scope: "repo",
    constraints: contract?.explicitConstraints ?? [],
    contract,
  }
}
