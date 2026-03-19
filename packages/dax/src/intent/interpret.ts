import type { IntentEnvelope, IntentType } from "./types"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"

export interface IntentContext {
  cwd: string
  session_id?: string
  recent_history?: string[]
  session_title?: string
  current_focus?: string
  todo?: string[]
  recent_activity?: string[]
  recent_tools?: string[]
  pending_approvals?: number
  pending_questions?: number
  audit_status?: "pass" | "warn" | "fail"
}

type ContractDraft = {
  goal: string
  plan: string[]
  successCriteria: string[]
  constraints: string[]
  contextSignals?: string[]
  operatorWatchouts?: string[]
  targetFiles?: string[]
  validationCommands?: string[]
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

function defaultValidationCommands(commandHint?: string) {
  return commandHint ? [commandHint] : []
}

export function formatStructuredExecutionContract(contract: ContractDraft) {
  return [
    "## Goal",
    contract.goal,
    ...(contract.targetFiles && contract.targetFiles.length > 0
      ? ["", "## Likely Targets", ...contract.targetFiles.map((item) => `- ${item}`)]
      : []),
    ...(contract.contextSignals && contract.contextSignals.length > 0
      ? ["", "## Session Context", ...contract.contextSignals.map((item) => `- ${item}`)]
      : []),
    "",
    "## Execution Plan",
    ...contract.plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Success Criteria",
    ...contract.successCriteria.map((item) => `- ${item}`),
    ...(contract.validationCommands && contract.validationCommands.length > 0
      ? ["", "## Validation Commands", ...contract.validationCommands.map((item) => `- ${item}`)]
      : []),
    ...(contract.constraints.length > 0
      ? ["", "## Constraints & Requirements", ...contract.constraints.map((item) => `- ${item}`)]
      : []),
    ...(contract.operatorWatchouts && contract.operatorWatchouts.length > 0
      ? ["", "## Operator Watchouts", ...contract.operatorWatchouts.map((item) => `- ${item}`)]
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
          sessionContext: z
            .array(z.string())
            .describe("2-5 short bullets capturing relevant live session context, current focus, or milestones when they materially help execution.")
            .default([]),
          plan: z
            .array(z.string())
            .describe(
              "A structured, ordered list of 4-7 specific steps required to fulfill the goal. Mention specific files, commands, or patterns where possible.",
            ),
          successCriteria: z
            .array(z.string())
            .describe("3-5 verifiable and explicit conditions that define the task as complete."),
          targetFiles: z
            .array(z.string())
            .describe("0-4 likely files, directories, or product surfaces that should be inspected first.")
            .default([]),
          validationCommands: z
            .array(z.string())
            .describe("0-3 concrete validation commands or checks that would prove the work is complete.")
            .default([]),
          constraints: z
            .array(z.string())
            .describe("Project boundaries, performance rules, or style guidelines the AI must not violate."),
          operatorWatchouts: z
            .array(z.string())
            .describe("0-3 short watchouts about approvals, risk, governance, or validation gaps the operator should keep in mind.")
            .default([]),
        }),
        prompt: `You are an expert software engineer and AI task planner.
Your objective is to translate the user's prompt into a rigorous "Structured Execution Contract". This contract will guide an autonomous AI agent.

USER REQUEST: "${prompt}"
CURRENT WORKING DIRECTORY: ${context.cwd}
${context.session_title ? `SESSION GOAL: ${context.session_title}` : ""}
${context.current_focus ? `CURRENT FOCUS: ${context.current_focus}` : ""}
${context.todo?.length ? `KNOWN MILESTONES: ${context.todo.slice(0, 5).join(" | ")}` : ""}
${context.recent_activity?.length ? `RECENT ACTIVITY: ${context.recent_activity.slice(0, 5).join(" | ")}` : ""}
${context.recent_tools?.length ? `RECENT TOOLS: ${context.recent_tools.slice(0, 4).join(" | ")}` : ""}
${context.recent_history?.length ? `RECENT USER HISTORY: ${context.recent_history.slice(0, 4).join(" | ")}` : ""}
${(context.pending_approvals ?? 0) > 0 ? `PENDING APPROVALS: ${context.pending_approvals}` : ""}
${(context.pending_questions ?? 0) > 0 ? `PENDING QUESTIONS: ${context.pending_questions}` : ""}
${context.audit_status ? `AUDIT STATUS: ${context.audit_status}` : ""}

INSTRUCTIONS:
1. Goal: Distill the exact outcome needed. Be precise.
2. Session Context: Surface the live context that materially changes how the agent should execute this request. Omit fluff.
3. Plan: Outline the logical sequence of operations. Avoid generic fluff like "understand requirements". Focus on what actually needs to be done (e.g. "Use grep to find X", "Edit Y to implement Z", "Run tests using 'npm test'").
4. Success Criteria: How will the agent know it is finished? Be objective and measurable.
5. Constraints: What rules must the agent follow? (e.g. "Do not break existing tests", "Only modify files in src/components", "Do not add new dependencies unless requested").
6. Operator Watchouts: Include only important approvals, governance concerns, or validation cautions.

Ensure your response perfectly aligns with the requested JSON schema.`,
      })

      const { goal, sessionContext, plan, successCriteria, targetFiles, validationCommands, constraints, operatorWatchouts } = result.object
      const formattedPrompt = formatStructuredExecutionContract({
        goal,
        targetFiles,
        contextSignals: sessionContext,
        plan,
        successCriteria,
        validationCommands,
        constraints,
        operatorWatchouts,
      })

      return {
        goal,
        executionPlan: plan,
        contextSignals: sessionContext,
        successCriteria,
        targetFiles,
        validationCommands,
        explicitConstraints: constraints,
        operatorWatchouts,
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
    executionPlan: enhancedFallback.plan,
    contextSignals: enhancedFallback.contextSignals,
    successCriteria: enhancedFallback.successCriteria,
    targetFiles: enhancedFallback.targetFiles,
    validationCommands: enhancedFallback.validationCommands,
    explicitConstraints: enhancedFallback.constraints,
    operatorWatchouts: enhancedFallback.operatorWatchouts,
    formattedPrompt: formattedFallback,
  } as any
}

function generateEnhancedFallback(prompt: string, lowerPrompt: string, context: IntentContext): ContractDraft {
  const hints = extractPromptHints(prompt)
  const target = summarizeTarget(prompt)
  const targetFiles = hints.fileHints.length > 0 ? hints.fileHints.join(", ") : undefined
  const targetCommand = hints.commandHints[0]
  const repoConstraint = `Stay within the active repository at ${context.cwd}`
  const contextSignals = buildContextSignals(context)
  const operatorWatchouts = buildOperatorWatchouts(context)

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
      targetFiles: hints.fileHints,
      validationCommands: defaultValidationCommands(),
      constraints: ["Read-only analysis preferred", "Focus on understanding structure", repoConstraint],
      contextSignals,
      operatorWatchouts,
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
      targetFiles: hints.fileHints,
      validationCommands: defaultValidationCommands(targetCommand || "Run the smallest relevant test or verification command"),
      constraints: [
        "Minimize the change surface until the root cause is confirmed",
        "Preserve existing behavior outside the broken path",
        repoConstraint,
      ],
      contextSignals,
      operatorWatchouts,
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
      targetFiles: hints.fileHints,
      validationCommands: defaultValidationCommands(targetCommand || "Run the most relevant verification command for the changed surface"),
      constraints: ["Preserve existing functionality unless the request explicitly changes it", repoConstraint],
      contextSignals,
      operatorWatchouts,
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
      targetFiles: hints.fileHints,
      validationCommands: ["Re-read the updated docs for accuracy and completeness"],
      constraints: ["Follow existing documentation style", repoConstraint],
      contextSignals,
      operatorWatchouts,
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
      targetFiles: hints.fileHints,
      validationCommands: defaultValidationCommands(targetCommand || "Run the relevant test command"),
      constraints: ["Follow existing test patterns", repoConstraint],
      contextSignals,
      operatorWatchouts,
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
    targetFiles: hints.fileHints,
    validationCommands: defaultValidationCommands(targetCommand),
    constraints: [repoConstraint],
    contextSignals,
    operatorWatchouts,
  }
}

function buildContextSignals(context: IntentContext) {
  const signals: string[] = []
  if (context.session_title) signals.push(`Current session goal: ${context.session_title}`)
  if (context.current_focus) signals.push(`Current focus: ${context.current_focus}`)
  if (context.todo?.length) signals.push(`Known milestones: ${context.todo.slice(0, 4).join(" | ")}`)
  if (context.recent_activity?.length) signals.push(`Recent thread: ${context.recent_activity.slice(0, 3).join(" | ")}`)
  if (context.recent_tools?.length) signals.push(`Recent tool activity: ${context.recent_tools.slice(0, 3).join(" | ")}`)
  if (context.recent_history?.length) signals.push(`Latest user context: ${context.recent_history.slice(0, 2).join(" | ")}`)
  return unique(signals).slice(0, 5)
}

function buildOperatorWatchouts(context: IntentContext) {
  const watchouts: string[] = []
  if ((context.pending_approvals ?? 0) > 0) watchouts.push(`There ${context.pending_approvals === 1 ? "is" : "are"} ${context.pending_approvals} pending approval${context.pending_approvals === 1 ? "" : "s"} that may block execution.`)
  if ((context.pending_questions ?? 0) > 0) watchouts.push(`There ${context.pending_questions === 1 ? "is" : "are"} ${context.pending_questions} open operator question${context.pending_questions === 1 ? "" : "s"} that may need an answer first.`)
  if (context.audit_status === "warn") watchouts.push("Audit posture is warning. Prefer smaller changes and explicit verification.")
  if (context.audit_status === "fail") watchouts.push("Audit posture is blocked. Treat governance findings as release blockers until resolved.")
  return watchouts
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
