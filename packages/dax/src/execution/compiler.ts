import { deriveDefaultValidationCommands } from "./default-validation-commands"
import { Identifier } from "@/id/id"
import * as crypto from "crypto"
import type { WorkflowClass, RiskLevel } from "./workflow-class"
import { ExecutionContract, ApprovalPolicy, deriveExecutionMode, type RuntimePolicy } from "./execution-contract"
import type { CreateRunRequest } from "@/server/run-contract"
import { EDIT_TOOL_IDS, SHELL_TOOL_IDS, isEditTool, isMutatingTool } from "@/tool/tool-class"
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

// Edit/shell tool classification comes from the single source of truth in
// tool/tool-class.ts. DANGEROUS_TOOLS stays local: it is a compiler-specific
// review-mode blocklist, not a tool identity taxonomy.
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

/**
 * Verbs that imply the run intends to change the tree. Only consulted for the
 * `generic` class, where the workflow itself does not settle the question.
 */
const MUTATING_INTENT = /\b(fix|edit|write|change|patch|refactor|implement|add|remove|delete|rename|migrate|update)\b/i

function extractLikelyTargets(intent: string): string[] {
  return unique(
    Array.from(intent.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+\b/g)).map((match) => match[0]),
  ).slice(0, 8)
}

/**
 * `riskLevel` is deliberately not a parameter. Verification is owed when the run
 * is granted write authority, not when its risk band is high — a low-risk run
 * that may write still owes evidence, and a high-risk read-only one does not.
 */
function deriveRuntimePolicy(request: CreateRunRequest, workflowClass: WorkflowClass): RuntimePolicy {
  const targetFiles = extractLikelyTargets(request.intent.input)
  const avoidAreas = unique([
    /\.env/i.test(request.intent.input) ? ".env*" : undefined,
    /secret|credential|token/i.test(request.intent.input) ? "credentials" : undefined,
    /github action|workflow|release/i.test(request.intent.input) ? ".github/workflows" : undefined,
  ])
  // These were prose ("run relevant tests"), which the verification allowlist
  // rejects — the field described an intention rather than a runnable check. They
  // are now real commands detected from the repository, so a contract that
  // requires evidence can actually produce some.
  const requestedValidation = unique([
    /test|pytest|vitest|jest/i.test(request.intent.input) ? "test" : undefined,
    /lint|eslint|ruff/i.test(request.intent.input) ? "lint" : undefined,
    /typecheck|tsc/i.test(request.intent.input) ? "typecheck" : undefined,
  ])

  // Verification is owed when the run is granted authority to change the tree.
  //
  // This used to be keyword-matched against the intent text, which made a
  // drafting run that applies nothing demand proof because the word "release"
  // appeared in the prompt — and then fail, because the same heuristic named no
  // commands to run. The requirement belongs to the authority granted, not to the
  // wording of the request.
  //
  // draft_and_approve produces an artifact for a human to approve and writes
  // nothing; repo_analyze and review_and_signoff only read. For those, the
  // operator's decision is the terminal check. worker_run always produces a patch.
  const grantsWriteAuthority =
    workflowClass === "worker_run" ||
    (workflowClass === "generic" && (targetFiles.length > 0 || MUTATING_INTENT.test(request.intent.input)))

  const verificationRequired = grantsWriteAuthority

  // Only detect checks for a run that owes evidence. A read-only run has nothing
  // to prove, and touching the filesystem to find that out is wasted work.
  const repoRoot = request.intent.repoPath ?? request.metadata?.targeting?.repoPath ?? process.cwd()
  const detected = verificationRequired ? deriveDefaultValidationCommands(repoRoot) : []

  // When the intent named particular kinds of check, honour that preference;
  // otherwise take everything the repo offers. Either way the result is commands
  // the allowlist accepts, or nothing.
  const preferred = detected.filter((command) => requestedValidation.some((kind) => command.endsWith(` ${kind}`)))
  const validationCommands = preferred.length > 0 ? preferred : detected

  const basePolicy: RuntimePolicy = {
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

  // For worker_run: operator/inferred constraints override base text-extracted values.
  // CLI flags always win; refineIntent inference is the fallback when no flags given.
  const wc = workflowClass === "worker_run" ? request.workerConstraints : undefined
  if (!wc) return basePolicy

  // When workerConstraints is present, the CLI sends exactly what the operator saw on the
  // veto card — explicit [] means "no scope stated," NOT "fall back to text extraction."
  // System-default forbidden patterns (../* etc.) are still prepended for safety.
  return {
    ...basePolicy,
    scope: {
      ...basePolicy.scope,
      targetFiles: wc.writeScope ?? [],
    },
    postconditions: {
      ...basePolicy.postconditions,
      validationCommands: wc.verification ?? [],
    },
    sensitivity: {
      ...basePolicy.sensitivity,
      forbiddenPatterns: unique([
        ...basePolicy.sensitivity.forbiddenPatterns,
        ...(wc.forbiddenPaths ?? []),
      ]),
    },
    provenance: wc.provenance,
    // Egress confinement rides through to worker_run. Absent leaves the adapter
    // default (filter on); an explicit block carries the operator's choice.
    egress: wc.egress
      ? { filter: wc.egress.filter ?? true, allowHosts: wc.egress.allowHosts ?? [] }
      : undefined,
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
    return tools.filter((t) => !isMutatingTool(t))
  }

  if (/review|pr|pull.*request|audit/i.test(lowerIntent)) {
    return tools.filter((t) => !isEditTool(t) && !DANGEROUS_TOOLS.includes(t))
  }

  return tools
}

function deriveToolBlocklist(intent: string, workflowClass: WorkflowClass): string[] {
  const blocklist: string[] = []

  if (workflowClass === "repo_analyze") {
    blocklist.push(...EDIT_TOOL_IDS, ...SHELL_TOOL_IDS)
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
    } else if (hintedWorkflow === "worker_run") {
      // An explicit worker request is an authority boundary, not a routing
      // suggestion. Keep it on the worker workflow so its provider validation
      // fails closed; silently falling back to native execution would select a
      // different executor with different authority semantics.
      workflowClass = "worker_run"
      workflowHintAccepted = false
      warnings.push(
        `Workflow hint "worker_run" requires providerHint "worker:<claude|codex|gemini>" and will fail closed.`,
      )
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
  const runtimePolicy = deriveRuntimePolicy(request, workflowClass)

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

  // "generic" is the explicit native-session workflow. Unlike the fixed
  // workflows it does not claim a keyword-shaped orchestration; the native
  // harness will still derive risk, tool authority and verification from the
  // actual intent.
  if (hint === "generic") {
    return true
  }

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
