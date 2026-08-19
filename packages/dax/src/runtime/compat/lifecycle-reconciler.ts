import { Log } from "@/util/log"
import { getProjectedRunState } from "@/state/events/run-event-store"
import type { RunState } from "@/state/run-state"
import { RunStore } from "@/state/run-store"
import { deriveSessionLifecycleFromMessages } from "@/session/lifecycle"
import type { MessageV2 } from "@/session/message-v2"
import type { Session } from "@/session"
import type { RunStatus as RunStatusExternal } from "@/server/run-contract"
import type { RunStatus as RunStatusInternal } from "@/state/run-state"

const log = Log.create({ service: "lifecycle-reconciler" })
const legacyLog = Log.create({ service: "lifecycle-reconciler", subsystem: "legacy" })

export interface ReconciliationInput {
  runId: string
  session: Session.Info
  messages: MessageV2.WithParts[]
  pendingApprovalCount: number
}

export interface ReconciliationResult {
  status: RunStatusExternal
  isAuthoritative: boolean
  hasMismatches: boolean
  issues: string[]
}

/**
 * Derives external run status from lifecycle.
 * @param input - Reconciliation input
 * @returns External run status
 */
export function deriveStatusFromLifecycle(input: ReconciliationInput): RunStatusExternal {
  const lifecycle = deriveSessionLifecycleFromMessages({
    archivedAt: input.session.time.archived,
    pendingApprovalCount: input.pendingApprovalCount,
    retainedArtifactCount: input.session.state_v2?.artifacts.length ?? 0,
    diffCount: input.session.summary?.diffs?.length ?? input.session.summary?.files ?? 0,
    messages: input.messages,
    hasPlan: !!input.session.state_v2?.plan,
    isPlanning: input.session.state_v2?.plan?.status === "running",
  })

  switch (lifecycle.lifecycle_state) {
    case "created":
      return "created"
    case "awaiting_approval":
      return "waiting_approval"
    case "completed":
      return "completed"
    case "failed":
    case "blocked":
      return "failed"
    case "archived":
      return "cancelled"
    case "planning":
    case "ready":
    case "executing":
    default:
      return "running"
  }
}

/**
 * Converts internal run status to external status.
 * @param internal - Internal run status
 * @returns External run status
 */
export function toExternalStatus(internal: RunStatusInternal): RunStatusExternal {
  switch (internal) {
    case "compiled":
      return "created"
    case "created":
    case "queued":
    case "running":
    case "waiting_approval":
    case "completed":
    case "failed":
    case "cancelled":
      return internal
    default:
      return "created"
  }
}

/**
 * Reconciles run state by comparing persisted state with derived state.
 * @param input - Reconciliation input
 * @returns Reconciliation result with status and mismatch info
 */
export async function reconcileRunState(input: ReconciliationInput): Promise<ReconciliationResult> {
  const state = await getProjectedRunState(input.runId)
  const derivedStatus = deriveStatusFromLifecycle(input)

  if (!state) {
    legacyLog.warn("no persisted run state - using legacy lifecycle derivation", {
      runId: input.runId,
      sessionId: input.session.id,
      messageCount: input.messages.length,
    })
    return {
      status: derivedStatus,
      isAuthoritative: false,
      hasMismatches: false,
      issues: ["no persisted run state found"],
    }
  }

  const issues: string[] = []
  let hasMismatches = false

  const persistedStatus = toExternalStatus(state.status)
  if (persistedStatus !== derivedStatus) {
    issues.push(`status mismatch: persisted=${persistedStatus}, derived=${derivedStatus}`)
    hasMismatches = true
  }

  if (state.pendingApprovalIds.length !== input.pendingApprovalCount) {
    issues.push(
      `approval count mismatch: persisted=${state.pendingApprovalIds.length}, actual=${input.pendingApprovalCount}`,
    )
    hasMismatches = true
  }

  if (hasMismatches) {
    log.warn("run state reconciliation needed", {
      runId: input.runId,
      issues,
    })
  }

  return {
    status: persistedStatus,
    isAuthoritative: true,
    hasMismatches,
    issues,
  }
}

export async function getAuthoritativeStatus(
  runId: string,
  session: Session.Info,
  messages: MessageV2.WithParts[],
  pendingApprovalCount: number,
): Promise<RunStatusExternal> {
  const reconciliation = await reconcileRunState({
    runId,
    session,
    messages,
    pendingApprovalCount,
  })

  if (reconciliation.isAuthoritative && !reconciliation.hasMismatches) {
    return reconciliation.status
  }

  log.info("using derived status (no authoritative state)", {
    runId,
    derivedStatus: reconciliation.status,
    issues: reconciliation.issues,
  })

  return reconciliation.status
}

export namespace LifecycleReconciler {
  export async function reconcile(input: ReconciliationInput): Promise<ReconciliationResult> {
    return reconcileRunState(input)
  }

  export async function getStatus(
    runId: string,
    session: Session.Info,
    messages: MessageV2.WithParts[],
    pendingApprovalCount: number,
  ): Promise<RunStatusExternal> {
    return getAuthoritativeStatus(runId, session, messages, pendingApprovalCount)
  }

  export function toExternal(status: RunStatusInternal): RunStatusExternal {
    return toExternalStatus(status)
  }

  export function isCompatible(): boolean {
    return true
  }
}
