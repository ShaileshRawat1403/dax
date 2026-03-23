import { replayRunState, ReplayResult } from "./replay"
import { RunStore } from "./run-store"
import { RunState, isTerminalStatus } from "./run-state"
import { Log } from "@/util/log"
import { RunGateway } from "@/server/run-gateway"

const log = Log.create({ service: "state-recovery" })

export interface RecoveryResult {
  success: boolean
  recoveredRunState?: RunState
  recoveredApprovals?: number
  error?: string
}

export class RecoveryError extends Error {
  constructor(
    message: string,
    public readonly runId: string,
  ) {
    super(`Recovery failed for run ${runId}: ${message}`)
    this.name = "RecoveryError"
  }
}

/**
 * Recovers a run from the event log, reconstructing its state.
 */
export async function recoverRun(runId: string): Promise<RecoveryResult> {
  log.info("starting recovery", { runId })

  // Try to get persisted state
  const persistedState = await RunStore.get(runId).catch(() => null)

  if (persistedState && isTerminalStatus(persistedState.status)) {
    log.info("run already in terminal state", { runId, status: persistedState.status })
    return { success: true, recoveredRunState: persistedState, recoveredApprovals: 0 }
  }

  // Need to reconstruct from events
  return recoverFromEvents(runId)
}

// Recover purely from event log
async function recoverFromEvents(runId: string): Promise<RecoveryResult> {
  try {
    const events = await RunGateway.replayEvents(runId)

    if (events.length === 0) {
      return { success: false, error: "No events found for run" }
    }

    const { state, pendingApprovals } = replayRunState(events)

    // Detect recovery scenario
    if (isTerminalStatus(state.status)) {
      log.info("recovered run is terminal", { runId, status: state.status })
      return { success: true, recoveredRunState: state, recoveredApprovals: pendingApprovals.length }
    }

    log.info("recovered run state", {
      runId,
      status: state.status,
      steps: state.steps.length,
      pendingApprovals: pendingApprovals.length,
    })

    return {
      success: true,
      recoveredRunState: state,
      recoveredApprovals: pendingApprovals.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("recovery failed", { runId, error: message })
    return { success: false, error: message }
  }
}

/**
 * Checks if a run appears interrupted and might need recovery.
 */
export async function needsRecovery(runId: string): Promise<boolean> {
  const state = await RunStore.get(runId).catch(() => null)
  if (!state) return true // No state = needs recovery

  // Non-terminal state without recent activity might need recovery
  if (!isTerminalStatus(state.status)) {
    const lastUpdate = new Date(state.updatedAt)
    const now = new Date()
    const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60)

    if (hoursSinceUpdate > 24) {
      return true // Likely interrupted
    }
  }

  return false
}

export async function getRecoverySummary(runId: string): Promise<{
  hasState: boolean
  isTerminal: boolean
  needsRecovery: boolean
  eventCount: number
}> {
  const state = await RunStore.get(runId).catch(() => null)
  const events = await RunGateway.replayEvents(runId)

  return {
    hasState: !!state,
    isTerminal: state ? isTerminalStatus(state.status) : false,
    needsRecovery: await needsRecovery(runId),
    eventCount: events.length,
  }
}
