import type { IntentEnvelope, IntentType } from "./types"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"

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
  try {
    const defaultModelInfo = await Provider.defaultModel()
    const model =
      (await Provider.getSmallModel(defaultModelInfo.providerID)) ||
      (await Provider.getModel(defaultModelInfo.providerID, defaultModelInfo.modelID))
    const languageModel = await Provider.getLanguage(model)

    const result = await generateObject({
      model: languageModel,
      schema: z.object({
        goal: z
          .string()
          .describe("A clear, actionable restatement of the user's intent as a concrete goal. Keep it brief."),
        successCriteria: z
          .array(z.string())
          .describe("3-5 clear, testable success criteria that indicate the task is complete."),
        explicitConstraints: z
          .array(z.string())
          .describe(
            "Any rules, boundaries, or constraints implied by the request or best practices. (e.g. 'Read-only access', 'Use React/Tailwind', 'Preserve existing data')",
          ),
      }),
      prompt: `You are an expert technical lead and planner. A user has provided a raw, unstructured request.
Your job is to refine this into a crisp, actionable Execution Contract.

Raw Request:
"${prompt}"

Context:
- Working Directory: ${context.cwd}
${context.recent_history ? `- Recent Context: ${context.recent_history.join(" | ")}` : ""}

Generate a structured execution contract. Expand on vague terms. Add necessary technical constraints if implied. Keep constraints pragmatic and strictly necessary.`,
    })

    return result.object
  } catch (error) {
    // Fallback heuristic if LLM call fails or no provider is configured
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
