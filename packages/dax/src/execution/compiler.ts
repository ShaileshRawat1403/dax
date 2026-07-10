import { Identifier } from "@/id/id"
import * as crypto from "crypto"
import type { WorkflowClass, RiskLevel } from "./workflow-class"
import { WorkflowClassSchema, RiskLevelSchema } from "./workflow-class"
import { ExecutionContract, ApprovalPolicy, deriveExecutionMode, type RuntimePolicy } from "./execution-contract"
import type { CreateRunRequest } from "@/server/run-contract"
import z from "zod"

export interface CompileInput {
  request: CreateRunRequest
  availableTools?: string[]
}

export interface CompileResult {
  contract: z.infer<typeof ExecutionContract>
  warnings: string[]
}

const DEFAULT_TOOLS = ["read", "write", "edit", "glob", "grep", "bash", "shell", "search", "browser", "todo", "task"]

const EDIT_TOOLS = ["write", "edit", "patch", "apply"]
const SHELL_TOOLS = ["bash", "shell", "exec", "run"]
const DANGEROUS_TOOLS = ["rm", "delete", "force", "drop"]

const WORKFLOW_KEYWORDS: Record<WorkflowClass, RegExp[]> = {
  generic: [],
  draft_and_approve: [
    /draft/i,
    /create.*file/i,
    /write.*to/i,
    /generate.*and.*approve/i,
    /propose.*change/i,
    /prepare.*commit/i,
  ],
  repo_analyze: [/analyze/i, /explore/i, /understand/i, /survey/i, /map.*code/i, /inspect/i],
  review_and_signoff: [/review/i, /pr.*review/i, /pull.*request/i, /check.*code/i, /audit/i, /assess/i],
  // worker_run is never keyword-inferred: governing an external agent is an
  // explicit operator choice (providerHint worker:<id>), not a guess.
  worker_run: [],
}

const RISK_INDICATORS: Array<{ pattern: RegExp; level: RiskLevel }> = [
  { pattern: /\b(critical|destroy|drop|truncate)\b/i, level: "critical" },
  { pattern: /\b(delete|remove|rm|kill)\b/i, level: "high" },
  { pattern: /\b(edit|write|patch|modify|change)\b/i, level: "medium" },
  { pattern: /\b(read|analyze|explore|review|list)\b/i, level: "low" },
]

const APPROVAL_MODE_BY_PERSONA: Record<string, "auto" | "approval_gated" | "manual"> = {
  strict: "manual",
  balanced: "approval_gated",
  relaxed: "auto",
}

function unique(items: Array<string | undefined | null>): string[] {
  return [...new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))]
}

function extractLikelyTargets(intent: string): string[] {
  return unique(
    Array.from(intent.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+\b/g)).map((match) => match[0]),
  ).slice(0, 8)
}

function deriveRuntimePolicy(
  request: CreateRunRequest,
  workflowClass: WorkflowClass,
  riskLevel: RiskLevel,
): RuntimePolicy {
  const targetFiles = extractLikelyTargets(request.intent.input)
  const avoidAreas = unique([
    /\.env/i.test(request.intent.input) ? ".env*" : undefined,
    /secret|credential|token/i.test(request.intent.input) ? "credentials" : undefined,
    /github action|workflow|release/i.test(request.intent.input) ? ".github/workflows" : undefined,
  ])
  const validationCommands = unique([
    /test|pytest|vitest|jest/i.test(request.intent.input) ? "run relevant tests" : undefined,
    /lint|eslint|ruff/i.test(request.intent.input) ? "run relevant lint checks" : undefined,
    /typecheck|tsc/i.test(request.intent.input) ? "run typecheck" : undefined,
  ])

  const verificationRequired =
    workflowClass !== "repo_analyze" ||
    riskLevel !== "low" ||
    /verify|test|check|release|ship|fix|edit|write|change|patch/i.test(request.intent.input)

  return {
    scope: {
      targetFiles,
      targetSubsystems: [],
      avoidAreas,
    },
    budgets: {
      maxFilesTouched: 8,
      maxMutatingCommands: 6,
      maxApprovalRequests: 4,
      maxRepeatedFailures: 3,
    },
    postconditions: {
      verificationRequired,
      validationPlan: verificationRequired ? ["Collect evidence before claiming completion"] : [],
      validationCommands,
    },
    sensitivity: {
      sensitivePatterns: [
        ".env*",
        ".github/workflows/*",
        ".npmrc",
        ".pypirc",
        ".git/config",
        "*secret*",
        "*credential*",
        "*token*",
        "*auth*",
      ],
      forbiddenPatterns: ["../*", "~/.z*", "/etc/*"],
    },
  }
}

function classifyWorkflow(intent: string): WorkflowClass {
  const lowerIntent = intent.toLowerCase()

  for (const [workflow, patterns] of Object.entries(WORKFLOW_KEYWORDS)) {
    if (workflow === "generic") continue
    for (const pattern of patterns) {
      if (pattern.test(lowerIntent)) {
        return workflow as WorkflowClass
      }
    }
  }

  return "generic"
}

function deriveRiskLevel(intent: string): RiskLevel {
  for (const { pattern, level } of RISK_INDICATORS) {
    if (pattern.test(intent)) {
      return level
    }
  }
  return "medium"
}

function deriveToolAllowlist(intent: string, availableTools?: string[]): string[] {
  const lowerIntent = intent.toLowerCase()
  const tools = availableTools ?? DEFAULT_TOOLS

  if (/read.*only|analyze|explore|understand|survey/i.test(lowerIntent)) {
    return tools.filter((t) => !EDIT_TOOLS.includes(t) && !SHELL_TOOLS.includes(t))
  }

  if (/review|pr|pull.*request|audit/i.test(lowerIntent)) {
    return tools.filter((t) => !EDIT_TOOLS.includes(t) && !DANGEROUS_TOOLS.includes(t))
  }

  return tools
}

function deriveToolBlocklist(intent: string, workflowClass: WorkflowClass): string[] {
  const blocklist: string[] = []

  if (workflowClass === "repo_analyze") {
    blocklist.push(...EDIT_TOOLS, ...SHELL_TOOLS)
  }

  if (workflowClass === "review_and_signoff") {
    blocklist.push("rm", "delete", "force", "drop")
  }

  return [...new Set(blocklist)]
}

function deriveApprovalPolicy(
  workflowClass: WorkflowClass,
  riskLevel: RiskLevel,
  personaPreset?: CreateRunRequest["personaPreset"],
): ApprovalPolicy {
  const personaMode = personaPreset?.approvalMode
  const personaRisk = personaPreset?.riskLevel
  const explicitMode = APPROVAL_MODE_BY_PERSONA[personaMode ?? ""] ?? personaMode

  if (explicitMode === "manual" || explicitMode === "approval_gated" || explicitMode === "auto") {
    return {
      mode: explicitMode,
      requireForRiskAbove: personaRisk === "critical" ? "critical" : personaRisk === "high" ? "high" : undefined,
      toolCategories:
        explicitMode === "approval_gated" || explicitMode === "manual" ? ["edit", "shell", "dangerous"] : undefined,
    }
  }

  const baseMode =
    workflowClass === "draft_and_approve" || workflowClass === "review_and_signoff" || workflowClass === "worker_run"
      ? "approval_gated"
      : riskLevel === "low"
        ? "auto"
        : "approval_gated"

  return {
    mode: baseMode,
    requireForRiskAbove: riskLevel === "critical" ? "critical" : riskLevel === "high" ? "high" : undefined,
    toolCategories: baseMode === "approval_gated" ? ["edit", "shell", "dangerous"] : undefined,
  }
}

function deriveExpectedOutputs(
  intent: string,
  workflowClass: WorkflowClass,
): z.infer<typeof ExecutionContract>["expectedOutputs"] {
  const lowerIntent = intent.toLowerCase()
  const outputs: z.infer<typeof ExecutionContract>["expectedOutputs"] = []

  if (workflowClass === "repo_analyze" || /analyze|explore|understand/i.test(lowerIntent)) {
    outputs.push({ type: "report", description: "Analysis report with findings" })
    if (/map|structure/i.test(lowerIntent)) {
      outputs.push({ type: "summary", description: "Code structure summary" })
    }
  }

  if (workflowClass === "review_and_signoff" || /review|pr|pull.*request/i.test(lowerIntent)) {
    outputs.push({ type: "report", description: "Review comments and assessment" })
    outputs.push({ type: "diff", description: "Suggested changes (if any)" })
  }

  if (workflowClass === "draft_and_approve" || /draft|create|write/i.test(lowerIntent)) {
    outputs.push({ type: "file", description: "Draft artifact" })
    outputs.push({ type: "diff", description: "Changes to be committed" })
  }

  if (workflowClass === "worker_run") {
    outputs.push({ type: "patch", description: "Kernel-computed patch produced by governed external worker" })
    outputs.push({ type: "diff", description: "Reviewable diff before approval" })
  }

  if (outputs.length === 0) {
    outputs.push({ type: "summary", description: "Execution summary" })
  }

  return outputs
}

export function compile(input: CompileInput): CompileResult {
  const { request, availableTools } = input
  const intent = request.intent.input
  const warnings: string[] = []

  const hintedWorkflow = request.workflowHint
  const classifiedWorkflow = classifyWorkflow(intent)

  let workflowClass: WorkflowClass
  let workflowHintAccepted: boolean | undefined = undefined

  if (hintedWorkflow) {
    if (isValidWorkflowHint(hintedWorkflow, intent, request.personaPreset?.providerHint)) {
      workflowClass = hintedWorkflow
      workflowHintAccepted = true
      if (hintedWorkflow !== classifiedWorkflow && classifiedWorkflow !== "generic") {
        warnings.push(
          `Workflow hint "${hintedWorkflow}" accepted. DAX classification suggested "${classifiedWorkflow}" but Picobot hint takes precedence.`,
        )
      }
    } else {
      workflowClass = classifiedWorkflow === "generic" ? "draft_and_approve" : classifiedWorkflow
      workflowHintAccepted = false
      warnings.push(
        `Workflow hint "${hintedWorkflow}" was ignored. DAX determined "${workflowClass}" is more appropriate based on intent analysis.`,
      )
    }
  } else {
    workflowClass = classifiedWorkflow
  }

  const riskLevel = deriveRiskLevel(intent)
  const explicitMode =
    APPROVAL_MODE_BY_PERSONA[request.personaPreset?.approvalMode ?? ""] ?? request.personaPreset?.approvalMode
  const executionMode = deriveExecutionMode(workflowClass, riskLevel, explicitMode)
  const toolAllowlist = deriveToolAllowlist(intent, availableTools)
  const toolBlocklist = deriveToolBlocklist(intent, workflowClass)
  const approvalPolicy = deriveApprovalPolicy(workflowClass, riskLevel, request.personaPreset)
  const expectedOutputs = deriveExpectedOutputs(intent, workflowClass)
  const runtimePolicy = deriveRuntimePolicy(request, workflowClass, riskLevel)

  if (toolAllowlist.length === 0) {
    warnings.push("Tool allowlist is empty - execution may be restricted")
  }

  if (riskLevel === "critical" && executionMode !== "manual") {
    warnings.push("Critical risk level detected - manual approval enforced")
  }

  const baseContractData = {
    workflowClass,
    workflowHint: hintedWorkflow,
    workflowHintAccepted,
    intent,
    executionMode,
    riskLevel,
    toolAllowlist,
    toolBlocklist,
    approvalPolicy,
    expectedOutputs,
    runtimePolicy,
    providerHint: request.personaPreset?.providerHint,
    modelHint: request.personaPreset?.modelHint,
    repoPath: request.intent.repoPath ?? request.metadata?.targeting?.repoPath,
    branch: request.intent.branch,
  }

  const contractDigest = crypto.createHash("sha256").update(JSON.stringify(baseContractData)).digest("hex")

  const contractData = {
    schemaVersion: "v1" as const,
    contractId: `ctr_${Identifier.create("session", false)}`,
    contractInstanceId: `inst_${Identifier.create("session", false)}`,
    contractDigest,
    runId: "",
    ...baseContractData,
    timeoutMs: 1800000,
    workspaceId: request.metadata?.workspaceId,
    projectId: request.metadata?.projectId,
    initiatedBy: request.metadata?.initiatedBy,
    createdAt: new Date().toISOString(),
  }

  const parsed = ExecutionContract.safeParse(contractData)
  if (!parsed.success) {
    warnings.push(`Contract validation: ${parsed.error.message}`)
  }

  return {
    contract: parsed.success ? parsed.data : contractData,
    warnings,
  }
}

function isValidWorkflowHint(hint: string, intent: string, providerHint?: string): boolean {
  const lowerIntent = intent.toLowerCase()

  if (hint === "draft_and_approve") {
    return /create|write|generate|make|build|implement|add|modify|refactor|fix|edit/i.test(lowerIntent)
  }

  if (hint === "repo_analyze") {
    return /analyze|explore|understand|survey|map.*code|inspect/i.test(lowerIntent)
  }

  if (hint === "review_and_signoff") {
    return /review|pr.*review|pull.*request|check.*code|audit|assess/i.test(lowerIntent)
  }

  if (hint === "worker_run") {
    return /^worker:(claude|codex|gemini)$/.test(providerHint ?? "")
  }

  return false
}

export function compileWithRunId(input: CompileInput, runId: string): CompileResult {
  const result = compile(input)
  if (result.contract.runId === "") {
    result.contract.runId = runId
  }
  return result
}
