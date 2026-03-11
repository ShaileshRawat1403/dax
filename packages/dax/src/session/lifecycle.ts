import type { MessageV2 } from "./message-v2"

export type SessionLifecycleState = "active" | "executing" | "completed" | "interrupted" | "abandoned" | "failed"

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
}): SessionLifecycleSummary {
  const signals = input.messages.map(toLifecycleMessageSignal)
  return evaluateSessionLifecycle({
    archivedAt: input.archivedAt,
    pendingApprovalCount: input.pendingApprovalCount,
    retainedArtifactCount: input.retainedArtifactCount,
    diffCount: input.diffCount,
    signals,
  })
}

export function evaluateSessionLifecycle(input: {
  archivedAt?: number
  pendingApprovalCount: number
  retainedArtifactCount?: number
  diffCount?: number
  signals: LifecycleMessageSignal[]
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

  if (hasInterruptedSignal) {
    return {
      lifecycle_state: "interrupted",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "execution_interrupted",
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

  if (input.archivedAt) {
    return {
      lifecycle_state: "completed",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "session_archived",
    }
  }

  if (hasRecordedProgressionCompletion) {
    return {
      lifecycle_state: "completed",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "execution_completed",
    }
  }

  if (hasToolDrivenTerminalCompletion) {
    return {
      lifecycle_state: "completed",
      terminal: true,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "tool_execution_completed",
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

  if (hasVisibleTerminalOutput && input.pendingApprovalCount === 0) {
    return {
      lifecycle_state: "active",
      terminal: false,
      requires_reconciliation: true,
      execution_started: executionStarted,
      completion_reason: "visible_output_without_session_closure",
    }
  }

  if (input.pendingApprovalCount > 0) {
    return {
      lifecycle_state: "active",
      terminal: false,
      requires_reconciliation: false,
      execution_started: executionStarted,
      completion_reason: "approval_pending",
    }
  }

  return {
    lifecycle_state: "active",
    terminal: false,
    requires_reconciliation: false,
    execution_started: executionStarted,
    completion_reason: executionStarted ? "execution_active" : undefined,
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
