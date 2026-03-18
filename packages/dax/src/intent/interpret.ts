import type { IntentEnvelope, IntentType } from "./types"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"

export interface IntentContext {
  cwd: string
  session_id?: string
  recent_history?: string[]
}

type ContractDraft = {
  goal: string
  plan: string[]
  successCriteria: string[]
  constraints: string[]
}

type PromptHints = {
  fileHints: string[]
  commandHints: string[]
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function summarizeTarget(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim()
}

function extractPromptHints(prompt: string): PromptHints {
  const fileHints = unique(
    Array.from(
      prompt.matchAll(
        /\b(?:[\w.-]+\/)+[\w.-]+\b|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|sh|sql|py|go|rs|java|kt|swift)\b/g,
      ),
    )
      .map((match) => match[0])
      .slice(0, 3),
  )

  const commandHints = unique(
    Array.from(prompt.matchAll(/`([^`]+)`/g))
      .map((match) => match[1].trim())
      .filter(Boolean)
      .slice(0, 2),
  )

  return { fileHints, commandHints }
}

export function formatStructuredExecutionContract(contract: ContractDraft) {
  return [
    "## Goal",
    contract.goal,
    "",
    "## Execution Plan",
    ...contract.plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Success Criteria",
    ...contract.successCriteria.map((item) => `- ${item}`),
    ...(contract.constraints.length > 0
      ? ["", "## Constraints & Requirements", ...contract.constraints.map((item) => `- ${item}`)]
      : []),
    "",
    "---",
    "Edit this contract above, then press Enter to execute.",
  ].join("\n")
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
          goal: z
            .string()
            .describe("A concise, actionable and highly technical restatement of the user's core intent."),
          plan: z
            .array(z.string())
            .describe(
              "A structured, ordered list of 4-7 specific steps required to fulfill the goal. Mention specific files, commands, or patterns where possible.",
            ),
          successCriteria: z
            .array(z.string())
            .describe("3-5 verifiable and explicit conditions that define the task as complete."),
          constraints: z
            .array(z.string())
            .describe("Project boundaries, performance rules, or style guidelines the AI must not violate."),
        }),
        prompt: `You are an expert software engineer and AI task planner.
Your objective is to translate the user's prompt into a rigorous "Structured Execution Contract". This contract will guide an autonomous AI agent.

USER REQUEST: "${prompt}"
CURRENT WORKING DIRECTORY: ${context.cwd}

INSTRUCTIONS:
1. Goal: Distill the exact outcome needed. Be precise.
2. Plan: Outline the logical sequence of operations. Avoid generic fluff like "understand requirements". Focus on what actually needs to be done (e.g. "Use grep to find X", "Edit Y to implement Z", "Run tests using 'npm test'").
3. Success Criteria: How will the agent know it is finished? Be objective and measurable.
4. Constraints: What rules must the agent follow? (e.g. "Do not break existing tests", "Only modify files in src/components", "Do not add new dependencies unless requested").

Ensure your response perfectly aligns with the requested JSON schema.`,
      })

      const { goal, plan, successCriteria, constraints } = result.object
      const formattedPrompt = formatStructuredExecutionContract({ goal, plan, successCriteria, constraints })

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
  const enhancedFallback = generateEnhancedFallback(prompt, lowerPrompt, context)
  const formattedFallback = formatStructuredExecutionContract(enhancedFallback)

  return {
    goal: enhancedFallback.goal,
    successCriteria: enhancedFallback.successCriteria,
    explicitConstraints: enhancedFallback.constraints,
    formattedPrompt: formattedFallback,
  } as any
}

function generateEnhancedFallback(prompt: string, lowerPrompt: string, context: IntentContext): ContractDraft {
  const hints = extractPromptHints(prompt)
  const target = summarizeTarget(prompt)
  const targetFiles = hints.fileHints.length > 0 ? hints.fileHints.join(", ") : undefined
  const targetCommand = hints.commandHints[0]
  const repoConstraint = `Stay within the active repository at ${context.cwd}`

  // Analyze the prompt to generate a better fallback
  const isExploration =
    lowerPrompt.includes("explore") ||
    lowerPrompt.includes("understand") ||
    lowerPrompt.includes("review") ||
    lowerPrompt.includes("analyze") ||
    lowerPrompt.includes("know") ||
    lowerPrompt.includes("what") ||
    lowerPrompt.includes("how")
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
      goal: `Understand the repository and answer: ${target}`,
      plan: [
        "Inspect top-level files and directories to map the repository boundary",
        `Find the primary entry points, startup paths, and orchestration surfaces${targetFiles ? ` relevant to ${targetFiles}` : ""}`,
        "Identify major modules and explain their responsibilities",
        "Summarize how control flows through the system in plain language",
        "Report what the repo is for, how it is used, and key risks or constraints",
      ],
      successCriteria: [
        "Repository structure documented",
        "Main entry points and core modules identified",
        "High-level architecture explained clearly",
        "Practical usage purpose stated with evidence",
      ],
      constraints: ["Read-only analysis preferred", "Focus on understanding structure", repoConstraint],
    }
  }

  if (isFix) {
    return {
      goal: `Fix the reported issue: ${target}`,
      plan: [
        `Inspect the failing area${targetFiles ? ` in or around ${targetFiles}` : ""} and confirm the root cause before editing`,
        targetCommand
          ? `Reproduce or validate the problem with the most relevant command: ${targetCommand}`
          : "Reproduce the issue with the smallest relevant command, test, or workflow",
        `Implement the smallest safe change that resolves the issue${targetFiles ? ` while keeping ${targetFiles} coherent` : ""}`,
        "Run targeted validation for the affected behavior, then run the nearest regression checks",
        "Summarize the fix, the evidence that it works, and any remaining risk or follow-up",
      ],
      successCriteria: [
        "The reported failure is resolved in a reproducible way",
        "Targeted verification for the affected path passes",
        "Nearby behavior is checked for regressions",
        "The fix is minimal and aligned with existing project patterns",
      ],
      constraints: [
        "Minimize the change surface until the root cause is confirmed",
        "Preserve existing behavior outside the broken path",
        repoConstraint,
      ],
    }
  }

  if (isBuild) {
    return {
      goal: `Implement the requested change: ${target}`,
      plan: [
        `Inspect the existing code paths, files, and interfaces involved${targetFiles ? `, especially ${targetFiles}` : ""}`,
        "Choose the smallest implementation approach that fits current project conventions",
        "Make the necessary code or configuration changes with clear boundaries",
        targetCommand
          ? `Run the most relevant validation command: ${targetCommand}`
          : "Run targeted verification for the changed behavior and expand to broader checks if needed",
        "Review the result for regressions, incomplete edges, and follow-up work",
      ],
      successCriteria: [
        "The requested behavior or output is implemented end to end",
        "The changed path is validated with concrete evidence",
        "The implementation follows existing project patterns and constraints",
        "No obvious regressions remain in adjacent behavior",
      ],
      constraints: ["Preserve existing functionality unless the request explicitly changes it", repoConstraint],
    }
  }

  if (isDocs) {
    return {
      goal: `Write or improve documentation for: ${target}`,
      plan: [
        "Identify the audience, missing information, and the docs surface that should change",
        "Review existing documentation and adjacent implementation details for accuracy",
        "Draft concise documentation with examples, commands, or workflows where helpful",
        "Check the final copy for correctness, scanning clarity, and consistency with existing docs",
      ],
      successCriteria: [
        "Documentation answers the user’s need clearly and accurately",
        "Examples and commands match the current implementation",
        "Tone and structure fit the existing documentation set",
      ],
      constraints: ["Follow existing documentation style", repoConstraint],
    }
  }

  if (isTest) {
    return {
      goal: `Add or improve tests for: ${target}`,
      plan: [
        `Identify the behavior, edge cases, and failure modes that need coverage${targetFiles ? ` around ${targetFiles}` : ""}`,
        "Use existing test style and helpers to add focused coverage first",
        "Add broader integration coverage only where unit-level checks are not enough",
        targetCommand ? `Run ${targetCommand}` : "Run the relevant test command and inspect failures carefully",
      ],
      successCriteria: [
        "New or updated tests cover the intended behavior and edge cases",
        "The relevant test suite passes",
        "Tests are readable and aligned with existing patterns",
      ],
      constraints: ["Follow existing test patterns", repoConstraint],
    }
  }

  // Default fallback
  return {
    goal: `Complete the request: ${target}`,
    plan: [
      "Clarify the concrete target, affected files, and validation path implied by the request",
      "Inspect the most relevant files or commands before making changes",
      "Execute the smallest useful change or investigation step",
      "Verify the outcome with concrete evidence and capture any follow-up work",
    ],
    successCriteria: [
      "The request is completed as described",
      "The result is checked with concrete evidence",
      "No obvious regressions or loose ends remain",
    ],
    constraints: [repoConstraint],
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
