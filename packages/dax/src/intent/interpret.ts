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
  const lowerPrompt = prompt.toLowerCase()

  // Try to get the model
  let languageModel = null
  try {
    const defaultModelInfo = await Provider.defaultModel()
    const model =
      (await Provider.getSmallModel(defaultModelInfo.providerID)) ||
      (await Provider.getModel(defaultModelInfo.providerID, defaultModelInfo.modelID))
    languageModel = await Provider.getLanguage(model)
  } catch (e) {
    // No model available, use fallback
  }

  // If we have a model, use it
  if (languageModel) {
    try {
      const result = await generateObject({
        model: languageModel,
        schema: z.object({
          goal: z.string().describe("A clear, actionable restatement of the user's intent. Be specific and technical."),
          plan: z.array(z.string()).describe("5-8 concrete steps to accomplish this task. Be specific."),
          successCriteria: z.array(z.string()).describe("3-5 testable conditions that prove the task is complete."),
          constraints: z.array(z.string()).describe("Technical constraints, boundaries, or requirements. Be specific."),
        }),
        prompt: `You are a senior software architect. Transform this vague request into a precise execution plan.

USER REQUEST: "${prompt}"

CONTEXT: Working directory: ${context.cwd}

OUTPUT REQUIREMENTS:
- goal: What exactly needs to be done (technical and specific)
- plan: Numbered steps the AI should take
- successCriteria: How we know it worked (testable)
- constraints: Any limitations or requirements

Respond with ONLY the JSON object.`,
      })

      const { goal, plan, successCriteria, constraints } = result.object

      // Format as a beautiful markdown for the UI
      const formattedPrompt = [
        `## 🎯 Goal`,
        goal,
        "",
        "## 📋 Execution Plan",
        ...plan.map((s, i) => `${i + 1}. ${s}`),
        "",
        "## ✅ Success Criteria",
        ...successCriteria.map((s) => `- ${s}`),
        "",
        "## ⚙️ Constraints & Requirements",
        ...constraints.map((s) => `- ${s}`),
        "",
        "---",
        "_Edit this contract above, then press Enter to execute._",
      ].join("\n")

      return {
        goal,
        successCriteria,
        explicitConstraints: constraints,
        formattedPrompt,
      } as any
    } catch (error) {
      // LLM call failed, fall through to fallback
    }
  }

  // Enhanced fallback when LLM fails
  const enhancedFallback = generateEnhancedFallback(prompt, lowerPrompt)

  const formattedFallback = [
    `## 🎯 Goal`,
    enhancedFallback.goal,
    "",
    "## 📋 Execution Plan",
    ...enhancedFallback.plan.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## ✅ Success Criteria",
    ...enhancedFallback.successCriteria.map((s) => `- ${s}`),
    "",
    "## ⚙️ Constraints & Requirements",
    ...enhancedFallback.constraints.map((s) => `- ${s}`),
    "",
    "---",
    "_Edit this contract above, then press Enter to execute._",
  ].join("\n")

  return {
    goal: enhancedFallback.goal,
    successCriteria: enhancedFallback.successCriteria,
    explicitConstraints: enhancedFallback.constraints,
    formattedPrompt: formattedFallback,
  } as any
}

function generateEnhancedFallback(prompt: string, lowerPrompt: string) {
  // Analyze the prompt to generate a better fallback
  const isExploration =
    lowerPrompt.includes("explore") ||
    lowerPrompt.includes("understand") ||
    lowerPrompt.includes("review") ||
    lowerPrompt.includes("analyze")
  const isBuild =
    lowerPrompt.includes("build") ||
    lowerPrompt.includes("create") ||
    lowerPrompt.includes("add") ||
    lowerPrompt.includes("implement")
  const isFix =
    lowerPrompt.includes("fix") ||
    lowerPrompt.includes("bug") ||
    lowerPrompt.includes("error") ||
    lowerPrompt.includes("issue")
  const isDocs = lowerPrompt.includes("doc") || lowerPrompt.includes("readme")
  const isTest = lowerPrompt.includes("test") || lowerPrompt.includes("spec")

  if (isExploration) {
    return {
      goal: `Explore and analyze the codebase: ${prompt}`,
      plan: [
        "Map repository structure and identify key directories",
        "Identify entry points and main modules",
        "List dependencies and their versions",
        "Identify key patterns and conventions used",
        "Provide summary of codebase architecture",
      ],
      successCriteria: [
        "Repository structure documented",
        "Key files and modules identified",
        "Dependencies listed",
        "Architecture patterns identified",
      ],
      constraints: ["Read-only analysis preferred", "Focus on understanding structure"],
    }
  }

  if (isBuild) {
    return {
      goal: `Implement: ${prompt}`,
      plan: [
        "Analyze requirements and determine best approach",
        "Create necessary files or modify existing ones",
        "Ensure code follows project conventions",
        "Test the implementation",
        "Verify changes work as expected",
      ],
      successCriteria: [
        "Code implemented as requested",
        "Tests pass",
        "No breaking changes",
        "Code follows project patterns",
      ],
      constraints: ["Preserve existing functionality", "Follow project coding standards"],
    }
  }

  if (isFix) {
    return {
      goal: `Fix issue: ${prompt}`,
      plan: [
        "Locate the problematic code",
        "Understand the root cause",
        "Implement a fix",
        "Test the fix",
        "Verify no regressions",
      ],
      successCriteria: ["Bug fixed", "No regressions", "Tests pass"],
      constraints: ["Minimize changes", "Preserve existing behavior"],
    }
  }

  if (isDocs) {
    return {
      goal: `Generate documentation: ${prompt}`,
      plan: [
        "Identify what needs documentation",
        "Research existing documentation",
        "Write clear, concise documentation",
        "Add examples where helpful",
      ],
      successCriteria: ["Documentation complete", "Clear and accurate", "Helpful for developers"],
      constraints: ["Follow existing documentation style"],
    }
  }

  if (isTest) {
    return {
      goal: `Write tests: ${prompt}`,
      plan: [
        "Identify what needs testing",
        "Write unit tests",
        "Write integration tests if needed",
        "Verify tests pass",
      ],
      successCriteria: ["Tests written", "Tests pass", "Good coverage of functionality"],
      constraints: ["Follow existing test patterns"],
    }
  }

  // Default fallback
  return {
    goal: prompt,
    plan: ["Understand the requirements", "Break down into steps", "Execute the plan", "Verify results"],
    successCriteria: ["Task completed as described", "No regressions"],
    constraints: [],
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
