import type { IntentEnvelope, IntentType } from "./types"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"

const INTENT_REFINEMENT_TIMEOUT_MS = 2500

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
  executionProfile?: {
    mode: "fast" | "balanced" | "safe" | "audit-heavy"
    riskLevel: "low" | "medium" | "high"
    writeScope: "none" | "single_file" | "multi_file" | "unknown"
    approvalLikelihood: "low" | "medium" | "high"
  }
  contractDelta?: {
    inferredScope?: string[]
    inferredTargets?: string[]
    addedValidation?: string[]
    unresolvedUnknowns?: string[]
  }
  validationPlan?: {
    preflight?: string[]
    postChange?: string[]
    shipReadiness?: string[]
  }
  governanceHints?: {
    likelyTriggers?: string[]
    lowerRiskAlternatives?: string[]
    operatorDecisionsNeeded?: string[]
  }
  repoImpact?: {
    targetFiles?: string[]
    targetSubsystems?: string[]
    docsImpact?: boolean
    testImpact?: boolean
    avoidAreas?: string[]
  }
  contextSignals?: string[]
  operatorWatchouts?: string[]
  targetFiles?: string[]
  validationCommands?: string[]
  executionMode?: "fast" | "balanced" | "safe" | "audit-heavy"
  riskLevel?: "low" | "medium" | "high"
  likelyWrites?: string[]
  approvalForecast?: string[]
  unknowns?: string[]
  rollbackPlan?: string[]
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

function firstNonEmpty(values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean)
}

function deriveWriteScope(likelyWrites: string[] | undefined): "none" | "single_file" | "multi_file" | "unknown" {
  if (!likelyWrites) return "unknown"
  if (likelyWrites.length === 0) return "none"
  if (likelyWrites.length === 1) return "single_file"
  return "multi_file"
}

function deriveApprovalLikelihood(input: {
  riskLevel?: "low" | "medium" | "high"
  approvalForecast?: string[]
  pendingApprovals?: number
  pendingQuestions?: number
  likelyWrites?: string[]
}): "low" | "medium" | "high" {
  if ((input.pendingApprovals ?? 0) > 0 || (input.pendingQuestions ?? 0) > 0) return "high"
  if ((input.approvalForecast?.length ?? 0) >= 2) return "high"
  if ((input.riskLevel ?? "medium") === "high") return "high"
  if ((input.approvalForecast?.length ?? 0) > 0 || (input.likelyWrites?.length ?? 0) > 1) return "medium"
  return "low"
}

function deriveTargetSubsystems(hints: PromptHints, prompt: string) {
  const fromPaths = hints.fileHints
    .map((item) => item.split("/").slice(0, -1).join("/"))
    .filter(Boolean)
  const keywords = Array.from(
    prompt.matchAll(/\b(auth|approval|governance|release|readme|docs|tests?|ui|tui|server|workflow|memory|refine)\b/gi),
  ).map((match) => match[1]!.toLowerCase())
  return unique([...fromPaths, ...keywords]).slice(0, 4)
}

function buildValidationPlan(input: {
  validationCommands?: string[]
  successCriteria: string[]
  targetFiles?: string[]
  riskLevel?: "low" | "medium" | "high"
  approvalForecast?: string[]
}) {
  const preflight = unique([
    input.targetFiles?.length ? `Inspect ${input.targetFiles.slice(0, 3).join(", ")} before changing implementation.` : "",
    input.approvalForecast?.length ? "Confirm likely approval checkpoints before the run reaches a write or destructive step." : "",
  ].filter(Boolean))

  const postChange = unique([
    ...(input.validationCommands ?? []),
    firstNonEmpty(input.successCriteria),
  ].filter(Boolean) as string[])

  const shipReadiness = unique([
    input.riskLevel === "high" ? "Review remaining risk and rollback readiness before considering the work done." : "",
    input.approvalForecast?.length ? "Confirm all approvals or operator questions have been resolved cleanly." : "",
    "Capture the final evidence, summary, and any follow-up work before handoff.",
  ].filter(Boolean))

  return { preflight, postChange, shipReadiness }
}

function buildGovernanceHints(input: {
  approvalForecast?: string[]
  riskLevel?: "low" | "medium" | "high"
  likelyWrites?: string[]
  validationCommands?: string[]
  pendingApprovals?: number
  pendingQuestions?: number
}) {
  const likelyTriggers = unique([
    ...(input.approvalForecast ?? []),
    (input.likelyWrites?.length ?? 0) > 1 ? "Multi-file edits can trigger extra review attention." : "",
    input.riskLevel === "high" ? "High-risk requests should stay in a safer execution posture until validated." : "",
  ].filter(Boolean))

  const lowerRiskAlternatives = unique([
    (input.likelyWrites?.length ?? 0) > 1 ? "Start with the smallest single-file slice before expanding the change surface." : "",
    (input.validationCommands?.length ?? 0) === 0 ? "Add a concrete validation command before executing writes." : "",
    input.riskLevel === "high" ? "Use safe or audit-heavy mode if the current request can be narrowed first." : "",
  ].filter(Boolean))

  const operatorDecisionsNeeded = unique([
    (input.pendingApprovals ?? 0) > 0 ? "Resolve existing approvals before relying on a smooth execution path." : "",
    (input.pendingQuestions ?? 0) > 0 ? "Answer the outstanding operator question before execution expands." : "",
    input.riskLevel === "high" ? "Confirm whether the operator wants the safer path or the faster path." : "",
  ].filter(Boolean))

  return { likelyTriggers, lowerRiskAlternatives, operatorDecisionsNeeded }
}

function buildRepoImpact(input: {
  hints: PromptHints
  prompt: string
  likelyWrites?: string[]
}) {
  const lowerPrompt = input.prompt.toLowerCase()
  const targetSubsystems = deriveTargetSubsystems(input.hints, input.prompt)
  const targetFiles = unique([...(input.hints.fileHints ?? []), ...(input.likelyWrites ?? [])]).slice(0, 5)
  const avoidAreas = unique([
    lowerPrompt.includes("docs") ? "" : "Avoid widening scope into unrelated docs unless the task clearly needs it.",
    lowerPrompt.includes("test") ? "" : "Avoid broad test-suite churn beyond the affected surface.",
    lowerPrompt.includes("release") ? "" : "Avoid release metadata or packaging changes unless this task directly targets shipping.",
  ].filter(Boolean))

  return {
    targetFiles,
    targetSubsystems,
    docsImpact: /\b(doc|readme|guide|changelog)\b/i.test(input.prompt),
    testImpact: /\b(test|spec|verify|validation)\b/i.test(input.prompt) || targetFiles.some((item) => /test|spec/i.test(item)),
    avoidAreas,
  }
}

function buildContractDelta(input: {
  prompt: string
  hints: PromptHints
  validationCommands?: string[]
  unknowns?: string[]
  riskLevel?: "low" | "medium" | "high"
}) {
  const scope = unique([
    input.hints.fileHints.length > 0 ? `Focused on ${input.hints.fileHints.length} likely file or path target(s).` : "No specific file target was given, so DAX should inspect before writing.",
    input.riskLevel === "high" ? "Elevated the execution posture because the request looks high risk." : "",
  ].filter(Boolean))
  const targets = input.hints.fileHints.map((item) => `Likely target inferred from prompt: ${item}`)
  const addedValidation = (input.validationCommands ?? []).map((item) => `Validation added: ${item}`)
  const unresolvedUnknowns = (input.unknowns ?? []).map((item) => `Operator assumption: ${item}`)
  return {
    inferredScope: scope,
    inferredTargets: targets,
    addedValidation,
    unresolvedUnknowns,
  }
}

function attachDerivedContractSections(
  draft: ContractDraft,
  input: {
    prompt: string
    context: IntentContext
    hints: PromptHints
  },
): ContractDraft {
  const executionProfile = {
    mode: draft.executionMode ?? "balanced",
    riskLevel: draft.riskLevel ?? "medium",
    writeScope: deriveWriteScope(draft.likelyWrites),
    approvalLikelihood: deriveApprovalLikelihood({
      riskLevel: draft.riskLevel,
      approvalForecast: draft.approvalForecast,
      pendingApprovals: input.context.pending_approvals,
      pendingQuestions: input.context.pending_questions,
      likelyWrites: draft.likelyWrites,
    }),
  }
  const validationPlan = buildValidationPlan({
    validationCommands: draft.validationCommands,
    successCriteria: draft.successCriteria,
    targetFiles: draft.targetFiles,
    riskLevel: draft.riskLevel,
    approvalForecast: draft.approvalForecast,
  })
  const governanceHints = buildGovernanceHints({
    approvalForecast: draft.approvalForecast,
    riskLevel: draft.riskLevel,
    likelyWrites: draft.likelyWrites,
    validationCommands: draft.validationCommands,
    pendingApprovals: input.context.pending_approvals,
    pendingQuestions: input.context.pending_questions,
  })
  const repoImpact = buildRepoImpact({
    hints: input.hints,
    prompt: input.prompt,
    likelyWrites: draft.likelyWrites,
  })
  const contractDelta = buildContractDelta({
    prompt: input.prompt,
    hints: input.hints,
    validationCommands: draft.validationCommands,
    unknowns: draft.unknowns,
    riskLevel: draft.riskLevel,
  })

  return {
    ...draft,
    executionProfile,
    validationPlan,
    governanceHints,
    repoImpact,
    contractDelta,
  }
}

export function formatStructuredExecutionContract(contract: ContractDraft) {
  return [
    "## Goal",
    contract.goal,
    ...(contract.executionProfile || contract.executionMode || contract.riskLevel
      ? [
          "",
          "## Execution Profile",
          ...(contract.executionProfile?.mode || contract.executionMode ? [`- Mode: ${contract.executionProfile?.mode ?? contract.executionMode}`] : []),
          ...(contract.executionProfile?.riskLevel || contract.riskLevel ? [`- Risk level: ${contract.executionProfile?.riskLevel ?? contract.riskLevel}`] : []),
          ...(contract.executionProfile?.writeScope ? [`- Write scope: ${contract.executionProfile.writeScope}`] : []),
          ...(contract.executionProfile?.approvalLikelihood ? [`- Approval likelihood: ${contract.executionProfile.approvalLikelihood}`] : []),
        ]
      : []),
    ...(contract.targetFiles && contract.targetFiles.length > 0
      ? ["", "## Likely Targets", ...contract.targetFiles.map((item) => `- ${item}`)]
      : []),
    ...(contract.repoImpact
      ? [
          "",
          "## Repo Impact",
          ...(contract.repoImpact.targetSubsystems?.length
            ? [`- Target subsystems: ${contract.repoImpact.targetSubsystems.join(", ")}`]
            : []),
          ...(contract.repoImpact.targetFiles?.length
            ? [`- Target files: ${contract.repoImpact.targetFiles.join(", ")}`]
            : []),
          ...(typeof contract.repoImpact.docsImpact === "boolean"
            ? [`- Docs impact: ${contract.repoImpact.docsImpact ? "yes" : "no"}`]
            : []),
          ...(typeof contract.repoImpact.testImpact === "boolean"
            ? [`- Test impact: ${contract.repoImpact.testImpact ? "yes" : "no"}`]
            : []),
          ...(contract.repoImpact.avoidAreas?.map((item) => `- Avoid area: ${item}`) ?? []),
        ]
      : []),
    ...(contract.likelyWrites && contract.likelyWrites.length > 0
      ? ["", "## Likely Writes", ...contract.likelyWrites.map((item) => `- ${item}`)]
      : []),
    ...(contract.contractDelta
      ? [
          "",
          "## Contract Delta",
          ...(contract.contractDelta.inferredScope?.map((item) => `- Inferred scope: ${item}`) ?? []),
          ...(contract.contractDelta.inferredTargets?.map((item) => `- Inferred target: ${item}`) ?? []),
          ...(contract.contractDelta.addedValidation?.map((item) => `- Added validation: ${item}`) ?? []),
          ...(contract.contractDelta.unresolvedUnknowns?.map((item) => `- Unresolved unknown: ${item}`) ?? []),
        ]
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
    ...(contract.validationPlan
      ? [
          "",
          "## Validation Plan",
          ...(contract.validationPlan.preflight?.length ? ["### Preflight", ...contract.validationPlan.preflight.map((item) => `- ${item}`)] : []),
          ...(contract.validationPlan.postChange?.length ? ["### Post-change", ...contract.validationPlan.postChange.map((item) => `- ${item}`)] : []),
          ...(contract.validationPlan.shipReadiness?.length
            ? ["### Ship readiness", ...contract.validationPlan.shipReadiness.map((item) => `- ${item}`)]
            : []),
        ]
      : []),
    ...(contract.approvalForecast && contract.approvalForecast.length > 0
      ? ["", "## Approval Forecast", ...contract.approvalForecast.map((item) => `- ${item}`)]
      : []),
    ...(contract.governanceHints
      ? [
          "",
          "## Governance Hints",
          ...(contract.governanceHints.likelyTriggers?.map((item) => `- Likely trigger: ${item}`) ?? []),
          ...(contract.governanceHints.lowerRiskAlternatives?.map((item) => `- Lower-risk path: ${item}`) ?? []),
          ...(contract.governanceHints.operatorDecisionsNeeded?.map((item) => `- Operator decision: ${item}`) ?? []),
        ]
      : []),
    ...(contract.constraints.length > 0
      ? ["", "## Constraints & Requirements", ...contract.constraints.map((item) => `- ${item}`)]
      : []),
    ...(contract.unknowns && contract.unknowns.length > 0
      ? ["", "## Unknowns & Assumptions", ...contract.unknowns.map((item) => `- ${item}`)]
      : []),
    ...(contract.operatorWatchouts && contract.operatorWatchouts.length > 0
      ? ["", "## Operator Watchouts", ...contract.operatorWatchouts.map((item) => `- ${item}`)]
      : []),
    ...(contract.rollbackPlan && contract.rollbackPlan.length > 0
      ? ["", "## Rollback & Recovery", ...contract.rollbackPlan.map((item) => `- ${item}`)]
      : []),
    "",
    "---",
    "Edit this contract above, then press Enter to execute.",
  ].join("\n")
}

function buildRefinementPrompt(prompt: string, context: IntentContext) {
  const lines = [
    "You are an expert software engineer and AI task planner.",
    'Your objective is to translate the user\'s prompt into a rigorous "Structured Execution Contract". This contract will guide an autonomous AI agent.',
    "",
    `USER REQUEST: "${prompt}"`,
    `CURRENT WORKING DIRECTORY: ${context.cwd}`,
  ]

  if (context.session_title) lines.push(`SESSION GOAL: ${context.session_title}`)
  if (context.current_focus) lines.push(`CURRENT FOCUS: ${context.current_focus}`)
  if (context.todo?.length) lines.push(`KNOWN MILESTONES: ${context.todo.slice(0, 5).join(" | ")}`)
  if (context.recent_activity?.length)
    lines.push(`RECENT ACTIVITY: ${context.recent_activity.slice(0, 5).join(" | ")}`)
  if (context.recent_tools?.length) lines.push(`RECENT TOOLS: ${context.recent_tools.slice(0, 4).join(" | ")}`)
  if (context.recent_history?.length)
    lines.push(`RECENT USER HISTORY: ${context.recent_history.slice(0, 4).join(" | ")}`)
  if ((context.pending_approvals ?? 0) > 0) lines.push(`PENDING APPROVALS: ${context.pending_approvals}`)
  if ((context.pending_questions ?? 0) > 0) lines.push(`PENDING QUESTIONS: ${context.pending_questions}`)
  if (context.audit_status) lines.push(`AUDIT STATUS: ${context.audit_status}`)

  lines.push(
    "",
    "INSTRUCTIONS:",
    "1. Goal: Distill the exact outcome needed. Be precise.",
    "2. Session Context: Surface the live context that materially changes how the agent should execute this request. Omit fluff.",
    `3. Plan: Outline the logical sequence of operations. Avoid generic fluff like "understand requirements". Focus on what actually needs to be done (e.g. "Use grep to find X", "Edit Y to implement Z", "Run tests using 'npm test'").`,
    "4. Success Criteria: How will the agent know it is finished? Be objective and measurable.",
    '5. Execution Mode and Risk: Pick the safest useful mode ("fast", "balanced", "safe", or "audit-heavy") and the overall risk level.',
    "6. Likely Writes: Predict the files, directories, or surfaces most likely to change.",
    "7. Approval Forecast: Forecast the most likely approval or governance pauses before execution.",
    '8. Constraints: What rules must the agent follow? (e.g. "Do not break existing tests", "Only modify files in src/components", "Do not add new dependencies unless requested").',
    "9. Unknowns: Capture only real assumptions or missing facts that could materially change execution.",
    "10. Operator Watchouts: Include only important approvals, governance concerns, or validation cautions.",
    "11. Rollback & Recovery: Add short, practical recovery steps when this work could misfire.",
    "12. Formatting: Use markdown to communicate clearly. Use headings (##) for sections. Use bullets (-) for lists. Use blockquotes (>) for key findings or warnings. Use tables for structured comparisons or data. This terminal renderer displays markdown with color-coded syntax.",
    "",
    "Ensure your response perfectly aligns with the requested JSON schema.",
  )

  return lines.join("\n")
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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("intent refinement timeout"), INTENT_REFINEMENT_TIMEOUT_MS)
      try {
        const result = await generateObject({
          model: languageModel,
          abortSignal: controller.signal,
          schema: z.object({
            goal: z
              .string()
              .describe("A concise, actionable and highly technical restatement of the user's core intent."),
            sessionContext: z
              .array(z.string())
              .describe(
                "2-5 short bullets capturing relevant live session context, current focus, or milestones when they materially help execution.",
              )
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
            executionMode: z
              .enum(["fast", "balanced", "safe", "audit-heavy"])
              .describe("The safest useful execution posture for this request.")
              .default("balanced"),
            riskLevel: z
              .enum(["low", "medium", "high"])
              .describe("Overall risk implied by the requested work.")
              .default("medium"),
            likelyWrites: z
              .array(z.string())
              .describe("0-4 likely files, directories, or surfaces that will probably be modified.")
              .default([]),
            approvalForecast: z
              .array(z.string())
              .describe("0-3 likely approval or governance checkpoints the operator should expect.")
              .default([]),
            constraints: z
              .array(z.string())
              .describe("Project boundaries, performance rules, or style guidelines the AI must not violate."),
            unknowns: z
              .array(z.string())
              .describe("0-3 unresolved assumptions or missing facts that could change the approach.")
              .default([]),
            operatorWatchouts: z
              .array(z.string())
              .describe(
                "0-3 short watchouts about approvals, risk, governance, or validation gaps the operator should keep in mind.",
              )
              .default([]),
            rollbackPlan: z
              .array(z.string())
              .describe("0-3 short recovery steps the operator can use if the execution goes wrong.")
              .default([]),
          }),
          prompt: buildRefinementPrompt(prompt, context),
        })

        const {
          goal,
          sessionContext,
          plan,
          successCriteria,
          targetFiles,
          validationCommands,
          executionMode,
          riskLevel,
          likelyWrites,
          approvalForecast,
          constraints,
          unknowns,
          operatorWatchouts,
          rollbackPlan,
        } = result.object
        const hints = extractPromptHints(prompt)
        const draft = attachDerivedContractSections(
          {
            goal,
            executionMode,
            riskLevel,
            targetFiles,
            likelyWrites,
            contextSignals: sessionContext,
            plan,
            successCriteria,
            validationCommands,
            approvalForecast,
            constraints,
            unknowns,
            operatorWatchouts,
            rollbackPlan,
          },
          { prompt, context, hints },
        )
        const formattedPrompt = formatStructuredExecutionContract(draft)

        return {
          goal: draft.goal,
          executionProfile: draft.executionProfile,
          contractDelta: draft.contractDelta,
          validationPlan: draft.validationPlan,
          governanceHints: draft.governanceHints,
          repoImpact: draft.repoImpact,
          executionPlan: draft.plan,
          contextSignals: draft.contextSignals,
          successCriteria: draft.successCriteria,
          targetFiles: draft.targetFiles,
          validationCommands: draft.validationCommands,
          executionMode: draft.executionMode,
          riskLevel: draft.riskLevel,
          likelyWrites: draft.likelyWrites,
          approvalForecast: draft.approvalForecast,
          explicitConstraints: draft.constraints,
          unknowns: draft.unknowns,
          operatorWatchouts: draft.operatorWatchouts,
          rollbackPlan: draft.rollbackPlan,
          formattedPrompt,
        } as any
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      // LLM call failed, fall through to fallback
    }
  }

  // Enhanced fallback when LLM fails
  const enhancedFallback = generateEnhancedFallback(prompt, lowerPrompt, context)
  const formattedFallback = formatStructuredExecutionContract(enhancedFallback)

  return {
    goal: enhancedFallback.goal,
    executionProfile: enhancedFallback.executionProfile,
    contractDelta: enhancedFallback.contractDelta,
    validationPlan: enhancedFallback.validationPlan,
    governanceHints: enhancedFallback.governanceHints,
    repoImpact: enhancedFallback.repoImpact,
    executionPlan: enhancedFallback.plan,
    contextSignals: enhancedFallback.contextSignals,
    successCriteria: enhancedFallback.successCriteria,
    targetFiles: enhancedFallback.targetFiles,
    validationCommands: enhancedFallback.validationCommands,
    executionMode: enhancedFallback.executionMode,
    riskLevel: enhancedFallback.riskLevel,
    likelyWrites: enhancedFallback.likelyWrites,
    approvalForecast: enhancedFallback.approvalForecast,
    explicitConstraints: enhancedFallback.constraints,
    unknowns: enhancedFallback.unknowns,
    operatorWatchouts: enhancedFallback.operatorWatchouts,
    rollbackPlan: enhancedFallback.rollbackPlan,
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
  const riskLevel = deriveRiskLevel(lowerPrompt, context)
  const executionMode = deriveExecutionMode(riskLevel, context)
  const approvalForecast = buildApprovalForecast(lowerPrompt, context, hints)
  const unknowns = buildUnknowns(prompt, lowerPrompt, hints, targetCommand)
  const rollbackPlan = buildRollbackPlan(riskLevel)
  const likelyWrites = hints.fileHints

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
    return attachDerivedContractSections({
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
      executionMode: executionMode === "fast" ? "balanced" : executionMode,
      riskLevel: riskLevel === "high" ? "medium" : riskLevel,
      likelyWrites: [],
      approvalForecast,
      unknowns,
      rollbackPlan,
    }, { prompt, context, hints })
  }

  if (isFix) {
    return attachDerivedContractSections({
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
      validationCommands: defaultValidationCommands(
        targetCommand || "Run the smallest relevant test or verification command",
      ),
      constraints: [
        "Minimize the change surface until the root cause is confirmed",
        "Preserve existing behavior outside the broken path",
        repoConstraint,
      ],
      contextSignals,
      operatorWatchouts,
      executionMode,
      riskLevel,
      likelyWrites,
      approvalForecast,
      unknowns,
      rollbackPlan,
    }, { prompt, context, hints })
  }

  if (isBuild) {
    return attachDerivedContractSections({
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
      validationCommands: defaultValidationCommands(
        targetCommand || "Run the most relevant verification command for the changed surface",
      ),
      constraints: ["Preserve existing functionality unless the request explicitly changes it", repoConstraint],
      contextSignals,
      operatorWatchouts,
      executionMode,
      riskLevel,
      likelyWrites,
      approvalForecast,
      unknowns,
      rollbackPlan,
    }, { prompt, context, hints })
  }

  if (isDocs) {
    return attachDerivedContractSections({
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
      executionMode: executionMode === "fast" ? "balanced" : executionMode,
      riskLevel: riskLevel === "high" ? "medium" : riskLevel,
      likelyWrites,
      approvalForecast,
      unknowns,
      rollbackPlan,
    }, { prompt, context, hints })
  }

  if (isTest) {
    return attachDerivedContractSections({
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
      executionMode,
      riskLevel,
      likelyWrites,
      approvalForecast,
      unknowns,
      rollbackPlan,
    }, { prompt, context, hints })
  }

  // Default fallback
  return attachDerivedContractSections({
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
    executionMode,
    riskLevel,
    likelyWrites,
    approvalForecast,
    unknowns,
    rollbackPlan,
  }, { prompt, context, hints })
}

function deriveRiskLevel(lowerPrompt: string, context: IntentContext): "low" | "medium" | "high" {
  if (
    lowerPrompt.includes("release") ||
    lowerPrompt.includes("deploy") ||
    lowerPrompt.includes("migration") ||
    lowerPrompt.includes("database") ||
    lowerPrompt.includes("delete") ||
    lowerPrompt.includes("remove") ||
    lowerPrompt.includes("security") ||
    context.audit_status === "fail"
  ) {
    return "high"
  }
  if (
    lowerPrompt.includes("fix") ||
    lowerPrompt.includes("refactor") ||
    lowerPrompt.includes("auth") ||
    lowerPrompt.includes("approval") ||
    lowerPrompt.includes("governance") ||
    context.audit_status === "warn"
  ) {
    return "medium"
  }
  return "low"
}

function deriveExecutionMode(
  riskLevel: "low" | "medium" | "high",
  context: IntentContext,
): "fast" | "balanced" | "safe" | "audit-heavy" {
  if (context.audit_status === "fail") return "audit-heavy"
  if (riskLevel === "high") return "safe"
  if ((context.pending_approvals ?? 0) > 0 || (context.pending_questions ?? 0) > 0) return "safe"
  if (riskLevel === "medium") return "balanced"
  return "fast"
}

function buildApprovalForecast(lowerPrompt: string, context: IntentContext, hints: PromptHints) {
  const forecast: string[] = []
  if (hints.fileHints.length > 0 || lowerPrompt.includes("edit") || lowerPrompt.includes("fix") || lowerPrompt.includes("implement")) {
    forecast.push("Expect review before non-trivial file writes or multi-file edits.")
  }
  if (
    lowerPrompt.includes("rm ") ||
    lowerPrompt.includes("delete") ||
    lowerPrompt.includes("remove") ||
    lowerPrompt.includes("migration")
  ) {
    forecast.push("Destructive or irreversible steps should pause for explicit operator approval.")
  }
  if ((context.pending_approvals ?? 0) > 0) {
    forecast.push("Existing pending approvals may need resolution before this run can continue smoothly.")
  }
  return unique(forecast).slice(0, 3)
}

function buildUnknowns(prompt: string, lowerPrompt: string, hints: PromptHints, commandHint?: string) {
  const unknowns: string[] = []
  if (!hints.fileHints.length) {
    unknowns.push("The affected files or subsystem are not explicit yet and may need quick discovery first.")
  }
  if (!commandHint && (lowerPrompt.includes("fix") || lowerPrompt.includes("build") || lowerPrompt.includes("test"))) {
    unknowns.push("The exact validation command is not named, so DAX may need to discover the right check before changing code.")
  }
  if (prompt.trim().split(/\s+/).length < 8) {
    unknowns.push("The request is terse enough that success boundaries may need one more pass before execution.")
  }
  return unique(unknowns).slice(0, 3)
}

function buildRollbackPlan(riskLevel: "low" | "medium" | "high") {
  const plan = [
    "Capture the current state before broad edits so the previous version is easy to inspect or restore.",
    "Use targeted verification after each meaningful step instead of waiting until the end.",
  ]
  if (riskLevel !== "low") {
    plan.push("If validation regresses, revert the narrow change set and re-check the failing path before proceeding.")
  }
  return plan.slice(0, 3)
}

function buildContextSignals(context: IntentContext) {
  const signals: string[] = []
  if (context.session_title) signals.push(`Current session goal: ${context.session_title}`)
  if (context.current_focus) signals.push(`Current focus: ${context.current_focus}`)
  if (context.todo?.length) signals.push(`Known milestones: ${context.todo.slice(0, 4).join(" | ")}`)
  if (context.recent_activity?.length) signals.push(`Recent thread: ${context.recent_activity.slice(0, 3).join(" | ")}`)
  if (context.recent_tools?.length)
    signals.push(`Recent tool activity: ${context.recent_tools.slice(0, 3).join(" | ")}`)
  if (context.recent_history?.length)
    signals.push(`Latest user context: ${context.recent_history.slice(0, 2).join(" | ")}`)
  return unique(signals).slice(0, 5)
}

function buildOperatorWatchouts(context: IntentContext) {
  const watchouts: string[] = []
  if ((context.pending_approvals ?? 0) > 0)
    watchouts.push(
      `There ${context.pending_approvals === 1 ? "is" : "are"} ${context.pending_approvals} pending approval${context.pending_approvals === 1 ? "" : "s"} that may block execution.`,
    )
  if ((context.pending_questions ?? 0) > 0)
    watchouts.push(
      `There ${context.pending_questions === 1 ? "is" : "are"} ${context.pending_questions} open operator question${context.pending_questions === 1 ? "" : "s"} that may need an answer first.`,
    )
  if (context.audit_status === "warn")
    watchouts.push("Audit posture is warning. Prefer smaller changes and explicit verification.")
  if (context.audit_status === "fail")
    watchouts.push("Audit posture is blocked. Treat governance findings as release blockers until resolved.")
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

  const envelope: IntentEnvelope = {
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

  if (context.session_id) {
    await Bus.publish(Lifecycle.IntentCreated, {
      runId: context.session_id,
      intentType: envelope.intentType,
      goal: contract?.goal ?? prompt,
      riskLevel: envelope.riskLevel,
      confidence: envelope.confidence,
    })
  }

  return envelope
}
