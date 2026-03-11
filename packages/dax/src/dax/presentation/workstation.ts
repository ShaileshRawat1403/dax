export type WorkstationLifecycle =
  | "planning"
  | "ready"
  | "executing"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"

export type WorkstationTrustPosture = "clear" | "review_needed" | "blocked"

export type WorkstationState = {
  lifecycle: WorkstationLifecycle
  lifecycleLabel: string
  goal?: string
  currentStep?: string
  trustPosture: WorkstationTrustPosture
  trustLabel: string
  planSummary: {
    goal?: string
    steps: Array<{ label: string; status: "pending" | "active" | "done" }>
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
    items: Array<{ label: string; kind?: string }>
    remainderCount: number
  }
  auditSummary: {
    approvals: number
    overrides: number
    evidencePresent: boolean
    findingsCount: number
    posture: WorkstationTrustPosture
  }
  alertSummary?: {
    level: "info" | "warning" | "error"
    message: string
  }
}

export function deriveWorkstationState(input: {
  stage: "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done"
  stageReason: string
  sessionStatusType: "busy" | "idle" | "retry"
  goal?: string
  todo: Array<{ content: string; status: string }>
  approvals: Array<{ label?: string; reason?: string }>
  questions: number
  artifacts: Array<{ label: string; kind?: string }>
  diffCount: number
  audit?: {
    status: "pass" | "warn" | "fail"
    blockerCount: number
    warningCount: number
    infoCount: number
  }
  alert?: {
    level: "info" | "warning" | "error"
    message: string
  }
}): WorkstationState {
  const currentTodo = input.todo.find((item) => item.status === "in_progress")
  const approvalsPending = input.approvals.length + input.questions
  const evidencePresent = input.artifacts.length > 0 || input.diffCount > 0
  const trustPosture = deriveTrustPosture({
    approvalsPending,
    evidencePresent,
    auditStatus: input.audit?.status,
    blockerCount: input.audit?.blockerCount ?? 0,
  })
  const lifecycle = deriveLifecycle({
    stage: input.stage,
    sessionStatusType: input.sessionStatusType,
    approvalsPending,
    alertLevel: input.alert?.level,
  })

  return {
    lifecycle,
    lifecycleLabel: labelLifecycle(lifecycle),
    goal: input.goal,
    currentStep: currentTodo?.content ?? input.stageReason,
    trustPosture,
    trustLabel: labelTrustPosture(trustPosture),
    planSummary: {
      goal: summarize(input.goal, 88),
      steps: input.todo.slice(0, 5).map((item) => ({
        label: summarize(item.content, 60) ?? item.content,
        status: item.status === "completed" ? "done" : item.status === "in_progress" ? "active" : "pending",
      })),
    },
    activitySummary: {
      items: compactActivityItems(input.stageReason, currentTodo?.content),
      current: summarize(input.stageReason, 88),
    },
    approvalSummary: {
      pendingCount: approvalsPending,
      topReason: input.approvals[0]?.reason ?? (input.questions > 0 ? "awaiting operator input" : undefined),
      topLabel: input.approvals[0]?.label ?? (input.questions > 0 ? "Open question" : undefined),
    },
    artifactSummary: {
      count: input.artifacts.length,
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
      findingsCount: (input.audit?.blockerCount ?? 0) + (input.audit?.warningCount ?? 0) + (input.audit?.infoCount ?? 0),
      posture: trustPosture,
    },
    alertSummary: input.alert,
  }
}

function deriveLifecycle(input: {
  stage: WorkstationStage
  sessionStatusType: "busy" | "idle" | "retry"
  approvalsPending: number
  alertLevel?: "info" | "warning" | "error"
}): WorkstationLifecycle {
  if (input.approvalsPending > 0 || input.stage === "waiting") return "awaiting_approval"
  if (input.sessionStatusType === "retry" || input.alertLevel === "error" || input.stage === "retrying") return "blocked"
  if (input.stage === "planning") return "planning"
  if (input.stage === "executing" || input.stage === "exploring" || input.stage === "thinking" || input.stage === "verifying")
    return "executing"
  if (input.stage === "done" && input.alertLevel === "warning") return "ready"
  if (input.stage === "done") return "completed"
  if (input.sessionStatusType === "idle") return "ready"
  return "ready"
}

type WorkstationStage = "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done"

function deriveTrustPosture(input: {
  approvalsPending: number
  evidencePresent: boolean
  auditStatus?: "pass" | "warn" | "fail"
  blockerCount: number
}): WorkstationTrustPosture {
  if (input.blockerCount > 0 || input.auditStatus === "fail") return "blocked"
  if (input.approvalsPending > 0 || !input.evidencePresent || input.auditStatus === "warn") return "review_needed"
  return "clear"
}

function compactActivityItems(stageReason: string, currentStep?: string) {
  const items = [currentStep, stageReason].filter(Boolean) as string[]
  return Array.from(new Set(items))
    .map((item) => summarize(item, 72) ?? item)
    .slice(0, 3)
}

function summarize(value: string | undefined, max: number) {
  if (!value) return value
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function labelLifecycle(lifecycle: WorkstationLifecycle) {
  switch (lifecycle) {
    case "planning":
      return "Planning"
    case "ready":
      return "Ready"
    case "executing":
      return "Executing"
    case "awaiting_approval":
      return "Awaiting approval"
    case "blocked":
      return "Blocked"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
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
