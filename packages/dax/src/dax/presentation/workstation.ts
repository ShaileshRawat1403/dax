import type { ExecutionReflection } from "@/session/state-types"
import { pendingApprovals } from "./approvals"

export type WorkstationLifecycle =
  | "understanding"
  | "planning"
  | "ready"
  | "executing"
  | "verifying"
  | "awaiting_approval"
  | "waiting_for_capacity"
  | "retrying"
  | "blocked"
  | "completed"
  | "failed"

export type WorkstationTrustPosture = "clear" | "review_needed" | "blocked"

export type WorkstationState = {
  sessionID: string
  lifecycle: WorkstationLifecycle
  lifecycleLabel: string
  phase: "understand" | "plan" | "execute" | "verify" | "complete"
  goal?: string
  currentStep?: string
  trustPosture: WorkstationTrustPosture
  trustLabel: string
  reflection?: ExecutionReflection
  reflectionHistory: ExecutionReflection[]
  planSummary: {
    goal?: string
    steps: Array<{ label: string; status: "pending" | "active" | "done" }>
    currentStepIndex: number
    totalSteps: number
  }
  activitySummary: {
    items: string[]
    current?: string
  }
  approvalSummary: {
    pendingCount: number
    topReason?: string
    topLabel?: string
  }
  artifactSummary: {
    count: number
    workspaceWrites: number
    reports: number
    metadata: number
    items: Array<{ label: string; kind?: string }>
    remainderCount: number
  }
  auditSummary: {
    approvals: number
    overrides: number
    evidencePresent: boolean
    findingsCount: number
    blockerCount: number
    warningCount: number
    posture: WorkstationTrustPosture
  }
  planQuality?: {
    score: number
    decision: "proceed" | "pause"
    failedChecks: string[]
  }
  completionProof?: {
    ready: boolean
    missing: string[]
  }
  blastRadius?: {
    level: "low" | "medium" | "high" | "critical"
    reason: string
    affected_areas: string[]
  }
  alertSummary?: {
    level: "info" | "warning" | "error"
    message: string
  }
}

export function deriveWorkstationState(input: {
  sessionID: string
  stage: "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done"
  stageReason: string
  sessionStatusType: "busy" | "idle" | "retry" | "delayed"
  goal?: string
  todo: Array<{ content: string; status: string }>
  approvals: Array<{ label?: string; reason?: string; status?: string }>
  questions: number
  artifacts: Array<{ label: string; kind?: string }>
  diffCount: number
  reflection?: ExecutionReflection
  reflectionHistory?: ExecutionReflection[]
  recentTooling?: Array<{ label: string; status?: string }>
  audit?: {
    status: "pass" | "warn" | "fail"
    blockerCount: number
    warningCount: number
    infoCount: number
  }
  planQuality?: {
    score: number
    decision: "proceed" | "pause"
    failedChecks: string[]
  }
  completionProof?: {
    ready: boolean
    missing: string[]
  }
  blastRadius?: {
    level: "low" | "medium" | "high" | "critical"
    reason: string
    affected_areas: string[]
  }
  alert?: {
    level: "info" | "warning" | "error" | "none"
    message: string
  }
}): WorkstationState {
  const currentTodo = input.todo.find((item) => item.status === "in_progress")
  const currentTodoIndex = input.todo.findIndex((item) => item.status === "in_progress")
  // Approvals stay in the array as historical records after resolution.
  // Only status="pending" entries are actionable. See ./approvals.ts.
  const actionableApprovals = pendingApprovals(input.approvals)
  const approvalsPending = actionableApprovals.length + input.questions
  const evidencePresent = input.artifacts.length > 0 || input.diffCount > 0
  const trustPosture = deriveTrustPosture({
    lifecycleHint: input.stage === "done" && approvalsPending === 0 ? "completed" : undefined,
    approvalsPending,
    evidencePresent,
    auditStatus: input.audit?.status,
    blockerCount: input.audit?.blockerCount ?? 0,
    completionProofReady: input.completionProof?.ready,
  })
  const lifecycle = deriveLifecycle({
    stage: input.stage,
    sessionStatusType: input.sessionStatusType,
    approvalsPending,
    alertLevel: input.alert?.level === "none" ? undefined : input.alert?.level,
  })

  const workspaceWrites = input.artifacts.filter((a) => a.kind === "workspace_file").length
  const reports = input.artifacts.filter((a) => a.kind === "report").length
  const metadata = input.artifacts.filter((a) => a.kind === "metadata").length
  const currentStep = resolveCurrentStep({
    currentTodo: currentTodo?.content,
    stageReason: input.stageReason,
    approvals: actionableApprovals,
    questions: input.questions,
    recentTooling: input.recentTooling ?? [],
  })

  return {
    sessionID: input.sessionID,
    lifecycle,
    lifecycleLabel: labelLifecycle(lifecycle),
    phase: derivePhase(input.stage),
    goal: input.goal,
    currentStep,
    trustPosture,
    trustLabel: labelTrustPosture(trustPosture),
    reflection: input.reflection,
    reflectionHistory: (input.reflectionHistory ?? []).slice(-5),
    planSummary: {
      goal: summarize(input.goal, 88),
      steps: input.todo.slice(0, 5).map((item) => ({
        label: summarize(item.content, 60) ?? item.content,
        status: item.status === "completed" ? "done" : item.status === "in_progress" ? "active" : "pending",
      })),
      currentStepIndex: currentTodoIndex === -1 ? 0 : currentTodoIndex + 1,
      totalSteps: input.todo.length,
    },
    activitySummary: {
      items: [
        ...trustGuardSignals({
          planQuality: input.planQuality,
          completionProof: input.completionProof,
        }),
        ...compactActivityItems(input.stageReason, currentStep, input.recentTooling ?? []),
      ].slice(0, 3),
      current: summarize(currentStep, 88),
    },
    approvalSummary: {
      pendingCount: approvalsPending,
      topReason:
        actionableApprovals[0]?.reason ?? (input.questions > 0 ? "awaiting operator input" : undefined),
      topLabel:
        actionableApprovals[0]?.label ?? (input.questions > 0 ? "Open question" : undefined),
    },
    artifactSummary: {
      count: input.artifacts.length,
      workspaceWrites,
      reports,
      metadata,
      items: input.artifacts.slice(0, 3).map((item) => ({
        label: summarize(item.label, 44) ?? item.label,
        kind: item.kind ? summarize(item.kind, 16) : undefined,
      })),
      remainderCount: Math.max(0, input.artifacts.length - 3),
    },
    auditSummary: {
      approvals: approvalsPending,
      overrides: 0,
      evidencePresent,
      findingsCount:
        (input.audit?.blockerCount ?? 0) + (input.audit?.warningCount ?? 0) + (input.audit?.infoCount ?? 0),
      blockerCount: input.audit?.blockerCount ?? 0,
      warningCount: input.audit?.warningCount ?? 0,
      posture: trustPosture,
    },
    planQuality: input.planQuality,
    completionProof: input.completionProof,
    blastRadius: input.blastRadius,
    alertSummary:
      input.alert && input.alert.level !== "none" ? { ...input.alert, level: input.alert.level as any } : undefined,
  }
}

function derivePhase(
  stage: "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done",
): "understand" | "plan" | "execute" | "verify" | "complete" {
  switch (stage) {
    case "exploring":
    case "thinking":
      return "understand"
    case "planning":
      return "plan"
    case "executing":
    case "retrying":
      return "execute"
    case "verifying":
    case "waiting":
      return "verify"
    case "done":
      return "complete"
  }
}

function deriveLifecycle(input: {
  stage: WorkstationStage
  sessionStatusType: "busy" | "idle" | "retry" | "delayed"
  approvalsPending: number
  alertLevel?: "info" | "warning" | "error"
}): WorkstationLifecycle {
  if (input.approvalsPending > 0 || input.stage === "waiting") return "awaiting_approval"
  if (input.sessionStatusType === "delayed") return "waiting_for_capacity"
  if (input.sessionStatusType === "retry" || input.stage === "retrying") return "retrying"
  if (input.alertLevel === "error") return "blocked"
  if (input.stage === "thinking" || input.stage === "exploring") return "understanding"
  if (input.stage === "planning") return "planning"
  if (input.stage === "executing") return "executing"
  if (input.stage === "verifying") return "verifying"
  if (input.stage === "done" && input.alertLevel === "warning") return "ready"
  if (input.stage === "done") return "completed"
  if (input.sessionStatusType === "idle") return "ready"
  return "ready"
}

type WorkstationStage =
  | "exploring"
  | "thinking"
  | "planning"
  | "executing"
  | "verifying"
  | "waiting"
  | "retrying"
  | "done"

function deriveTrustPosture(input: {
  lifecycleHint?: "completed"
  approvalsPending: number
  evidencePresent: boolean
  auditStatus?: "pass" | "warn" | "fail"
  blockerCount: number
  completionProofReady?: boolean
}): WorkstationTrustPosture {
  if (input.blockerCount > 0 || input.auditStatus === "fail") return "blocked"
  if (input.completionProofReady === false) return "review_needed"
  if (input.lifecycleHint === "completed" && input.approvalsPending === 0 && input.auditStatus !== "warn")
    return "clear"
  if (input.approvalsPending > 0 || !input.evidencePresent || input.auditStatus === "warn") return "review_needed"
  return "clear"
}

function compactActivityItems(
  stageReason: string,
  currentStep: string | undefined,
  recentTooling: Array<{ label: string; status?: string }>,
) {
  const toolItems = recentTooling
    .slice(0, 2)
    .map((item) => summarizeToolingLabel(item.label))
    .filter(Boolean)
  const items = [
    currentStep,
    isGenericOperationalReason(stageReason) && toolItems.length > 0 ? undefined : stageReason,
    ...toolItems,
  ].filter(Boolean) as string[]
  return Array.from(new Set(items))
    .map((item) => summarize(item, 72) ?? item)
    .slice(0, 3)
}

function summarizeToolingLabel(value: string | undefined) {
  if (!value) return value
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized
    .replace(/^shell\s*[·-]\s*/i, "")
    .replace(/^read\s*[·-]\s*/i, "Read ")
    .replace(/^write\s*[·-]\s*/i, "Wrote ")
    .replace(/^edit\s*[·-]\s*/i, "Edited ")
    .replace(/^apply_patch\s*[·-]\s*/i, "Patched ")
}

function trustGuardSignals(input: {
  planQuality?: { score: number; decision: "proceed" | "pause"; failedChecks: string[] }
  completionProof?: { ready: boolean; missing: string[] }
}) {
  const items: string[] = []
  if (input.planQuality?.decision === "pause") {
    const failed = input.planQuality.failedChecks.length
    items.push(`Plan gate ${input.planQuality.score}/100 (${failed} check${failed === 1 ? "" : "s"} flagged)`)
  }
  if (input.completionProof && input.completionProof.ready === false) {
    const missing = input.completionProof.missing.slice(0, 2).join(", ") || "missing evidence"
    items.push(`Completion proof missing: ${missing}`)
  }
  return items
}

function isLowSignalStageReason(value: string | undefined) {
  if (!value) return true
  return /^(idle|session processing|response stream active|reasoning stream active|waiting for stream content)$/i.test(
    value.trim(),
  )
}

function isGenericOperationalReason(value: string | undefined) {
  if (!value) return false
  return /^(reading files|searching the workspace|searching file contents|listing project files|running a command|writing a file|editing a file|patching files|structuring the task|updating the checklist|loading a skill)$/i.test(
    value.trim(),
  )
}

function resolveCurrentStep(input: {
  currentTodo?: string
  stageReason: string
  approvals: Array<{ label?: string; reason?: string }>
  questions: number
  recentTooling: Array<{ label: string; status?: string }>
}) {
  if (input.currentTodo) return input.currentTodo
  if (input.approvals.length > 0) {
    return input.approvals[0]?.reason || input.approvals[0]?.label || "Approval needs review"
  }
  if (input.questions > 0) return "Question needs review"
  const activeTool = input.recentTooling.find((item) => item.status === "pending")?.label
  if (activeTool && isGenericOperationalReason(input.stageReason)) return activeTool
  if (!isLowSignalStageReason(input.stageReason)) return input.stageReason
  if (activeTool) return activeTool
  const latestTool = input.recentTooling[0]?.label
  if (latestTool) return latestTool
  return input.stageReason
}

function summarize(value: string | undefined, max: number) {
  if (!value) return value
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function labelLifecycle(lifecycle: WorkstationLifecycle) {
  switch (lifecycle) {
    case "understanding":
      return "Understanding"
    case "planning":
      return "Planning"
    case "ready":
      return "Ready"
    case "executing":
      return "Executing"
    case "verifying":
      return "Verifying"
    case "awaiting_approval":
      return "Awaiting approval"
    case "waiting_for_capacity":
      return "Waiting for model capacity"
    case "retrying":
      return "Retrying"
    case "blocked":
      return "Blocked"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
  }
}

export function describeLifecycle(input: {
  lifecycle: WorkstationLifecycle
  retryNext?: number
}): string {
  switch (input.lifecycle) {
    case "waiting_for_capacity":
      return "The model provider is temporarily limiting capacity. DAX will continue automatically."
    case "retrying":
      return input.retryNext
        ? `Provider delay detected. Retrying automatically at ${input.retryNext}.`
        : "Provider delay detected. Retrying automatically."
    case "awaiting_approval":
      return "DAX is waiting for your approval before continuing."
    case "blocked":
      return "DAX needs intervention before it can safely continue."
    case "failed":
      return "DAX could not complete this run."
    default:
      return ""
  }
}

export function labelTrustPosture(posture: WorkstationTrustPosture) {
  switch (posture) {
    case "clear":
      return "Clear"
    case "review_needed":
      return "Review needed"
    case "blocked":
      return "Blocked"
  }
}
