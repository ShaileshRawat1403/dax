import type { MessageV2 } from "./message-v2"

export type SessionLifecycleState =
  | "created"
  | "planning"
  | "ready"
  | "executing"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "archived"

export type SessionLifecycleSummary = {
  lifecycle_state: SessionLifecycleState
  terminal: boolean
  requires_reconciliation: boolean
  execution_started: boolean
  completion_reason?: string
}

type LifecycleMessageSignal = {
  role: MessageV2.Info["role"]
  finish?: string
  completedAt?: number
  errorName?: string
  hasToolActivity: boolean
  hasPendingToolActivity: boolean
}

export function deriveSessionLifecycleFromMessages(input: {
  archivedAt?: number
  pendingApprovalCount: number
  retainedArtifactCount?: number
  diffCount?: number
  messages: MessageV2.WithParts[]
  hasPlan?: boolean
  isPlanning?: boolean
}): SessionLifecycleSummary {
  const signals = input.messages.map(toLifecycleMessageSignal)
  return evaluateSessionLifecycle({
    archivedAt: input.archivedAt,
    pendingApprovalCount: input.pendingApprovalCount,
    retainedArtifactCount: input.retainedArtifactCount,
    diffCount: input.diffCount,
    signals,
    hasPlan: input.hasPlan,
    isPlanning: input.isPlanning,
  })
}

export function evaluateSessionLifecycle(input: {
  archivedAt?: number
  pendingApprovalCount: number
  retainedArtifactCount?: number
  diffCount?: number
  signals: LifecycleMessageSignal[]
  hasPlan?: boolean
  isPlanning?: boolean
}): SessionLifecycleSummary {
  const assistantSignals = input.signals.filter((signal) => signal.role === "assistant")
  const executionStarted = assistantSignals.length > 0
  const hasPendingToolActivity = assistantSignals.some((signal) => signal.hasPendingToolActivity)
  const hasInterruptedSignal = assistantSignals.some(
    (signal) =>
      signal.errorName === "MessageAbortedError" ||
      signal.finish === "abort" ||
      signal.finish === "cancelled" ||
      signal.finish === "canceled",
  )
  const hasFailureSignal = assistantSignals.some((signal) => signal.errorName && signal.errorName !== "MessageAbortedError")
  const hasVisibleTerminalOutput = assistantSignals.some((signal) => signal.finish === "stop" && typeof signal.completedAt === "number")
  const completedToolSignalCount = assistantSignals.filter((signal) => signal.hasToolActivity && !signal.hasPendingToolActivity).length
  const hasRetainedOutputEvidence = (input.retainedArtifactCount ?? 0) > 0 || (input.diffCount ?? 0) > 0
  const hasRecordedProgressionCompletion =
    input.pendingApprovalCount === 0 &&
    hasVisibleTerminalOutput &&
    (assistantSignals.some((signal) => signal.hasToolActivity) ||
      assistantSignals.length > 1 ||
      input.signals.filter((signal) => signal.role === "user").length > 1)
  const hasToolDrivenTerminalCompletion =
    input.pendingApprovalCount === 0 &&
    !hasVisibleTerminalOutput &&
    !hasPendingToolActivity &&
    completedToolSignalCount > 0 &&
    hasRetainedOutputEvidence

  if (input.archivedAt) {
    return {
      lifecycle_state: "archived",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "session_archived",
    }
  }

  if (hasFailureSignal && !hasPendingToolActivity && input.pendingApprovalCount === 0) {
    return {
      lifecycle_state: "failed",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "execution_failed",
    }
  }

  if (hasInterruptedSignal) {
    return {
      lifecycle_state: "blocked",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "execution_interrupted",
    }
  }

  if (hasRecordedProgressionCompletion || hasToolDrivenTerminalCompletion) {
    return {
      lifecycle_state: "completed",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: hasRecordedProgressionCompletion ? "execution_completed" : "tool_execution_completed",
    }
  }

  if (input.pendingApprovalCount > 0) {
    return {
      lifecycle_state: "awaiting_approval",
      terminal: false,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "approval_pending",
    }
  }

  if (hasPendingToolActivity) {
    return {
      lifecycle_state: "executing",
      terminal: false,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "execution_in_progress",
    }
  }

  if (input.isPlanning) {
    return {
      lifecycle_state: "planning",
      terminal: false,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "session_planning",
    }
  }

  if (input.hasPlan && !executionStarted) {
    return {
      lifecycle_state: "ready",
      terminal: false,
      requires_reconciliation: false,
      execution_started: false,
      completion_reason: "session_ready",
    }
  }

  if (hasVisibleTerminalOutput && input.pendingApprovalCount === 0) {
    return {
      lifecycle_state: "executing",
      terminal: false,
      requires_reconciliation: true,
      execution_started: executionStarted,
      completion_reason: "visible_output_without_session_closure",
    }
  }

  return {
    lifecycle_state: executionStarted ? "executing" : "created",
    terminal: false,
    requires_reconciliation: false,
    execution_started: executionStarted,
    completion_reason: executionStarted ? "execution_active" : "session_created",
  }
}

function toLifecycleMessageSignal(message: MessageV2.WithParts): LifecycleMessageSignal {
  return {
    role: message.info.role,
    finish: "finish" in message.info ? message.info.finish : undefined,
    completedAt:
      "time" in message.info && "completed" in message.info.time ? (message.info.time.completed as number | undefined) : undefined,
    errorName: "error" in message.info ? message.info.error?.name : undefined,
    hasToolActivity: message.parts.some((part) => part.type === "tool"),
    hasPendingToolActivity: message.parts.some(
      (part) => part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error",
    ),
  }
}
