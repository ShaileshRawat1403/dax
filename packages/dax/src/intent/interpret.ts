import type { IntentEnvelope, IntentType } from "./types"

export interface IntentContext {
  cwd: string
  session_id?: string
  recent_history?: string[]
}

/**
 * Interpret a raw user prompt into a structured intent envelope.
 * This will eventually be backed by an LLM call or a robust parser.
 */
export async function interpretIntent(prompt: string, context: IntentContext): Promise<IntentEnvelope> {
  // TODO: implement actual interpretation logic with an LLM call.
  // For now, simple heuristic routing.

  const lowerPrompt = prompt.toLowerCase()
  let intentType: IntentType = "general_query"
  let suggestedOperator = "general" // Default operator
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
  } else if (lowerPrompt.includes("artifact") || lowerPrompt.includes("report")) {
    intentType = "artifact_inspect"
    suggestedOperator = "artifact"
    requiredSkills = ["artifact-audit"]
  } else if (lowerPrompt.includes("change this code") || lowerPrompt.includes("refactor")) {
    intentType = "code_change"
    suggestedOperator = "code" // A future operator
  } else if (lowerPrompt.includes("generate docs") || lowerPrompt.includes("document this")) {
    intentType = "docs_generate"
    suggestedOperator = "docs" // A future operator
  }

  return {
    intentType,
    confidence: 0.75, // Placeholder confidence
    activeMode: "execute", // Placeholder
    suggestedOperator,
    requiredSkills,
    requestedOutput: "narrative", // Placeholder
    riskLevel: "medium", // Placeholder
    scope: "repo", // Placeholder
    constraints: [], // Placeholder
  }
}
