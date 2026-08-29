import { replayRunState } from "./replay"
import { getRunAuthority, hasRunEvents, projectRunStateFromEvents, readRunEvents } from "./events/run-event-store"
import type { ReplayResult } from "./replay"
import { RunStore } from "./run-store"
import type { RunState } from "./run-state"
import { isTerminalStatus } from "./run-state"
import { Log } from "@/util/log"
import { RunGateway } from "@/server/run-gateway"

const log = Log.create({ service: "state-recovery" })

type RecoveryAuthoritySource =
  | { kind: "event-log"; state: NonNullable<Awaited<ReturnType<typeof projectRunStateFromEvents>>> }
  | { kind: "legacy"; state: Awaited<ReturnType<typeof RunStore.get>> }

async function loadRecoveryAuthoritySource(runId: string): Promise<RecoveryAuthoritySource> {
  const authority = await getRunAuthority(runId)
  if (authority === "event-log") {
    const state = await projectRunStateFromEvents(runId)
    if (!state) {
      throw new RecoveryError("Event-authority run has no canonical state", runId)
    }
    return { kind: "event-log", state }
  }
  if (authority === null && (await hasRunEvents(runId))) {
    throw new RecoveryError("Canonical events exist without a run authority marker", runId)
  }
  return { kind: "legacy", state: await RunStore.get(runId) }
}

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

  const source = await loadRecoveryAuthoritySource(runId)
  if (source.kind === "event-log") {
    return {
      success: true,
      recoveredRunState: source.state,
      recoveredApprovals: source.state.pendingApprovalIds.length,
    }
  }

  const persistedState = source.state

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
 * How long a non-terminal run may sit untouched before DAX treats it as
 * stranded rather than slow.
 *
 * Deliberately short. DAX is a local tool, and a run whose process is gone
 * stops updating immediately; the previous 24 hour window meant a crashed run
 * read as healthy for a full day.
 */
export const INTERRUPTED_RUN_THRESHOLD_MS = 10 * 60 * 1000

/**
 * Runs the ledger still calls live, whose process is evidently gone.
 *
 * Nothing else in DAX could answer this. recoverRun replays the event log and
 * returns what it says, reconcileRunState compares and reports mismatches, and
 * needsRecovery answers for one run at a time. All three are read-only, so a
 * run whose process died mid-flight stayed `running` in the ledger forever with
 * no error and no completion. For a product whose claim is that the record
 * reflects what happened, that is the record lying.
 */
export async function listInterruptedRuns(now = Date.now()): Promise<RunState[]> {
  // Deliberately unbounded. RunStore.list defaults to the first 100 keys, and
  // Storage.list sorts lexicographically, so with ULID-prefixed run ids that is
  // the *oldest* 100. Taking the default meant that once a project accumulated
  // more than a hundred runs, a run stranded yesterday was never looked at and
  // this returned "nothing stranded" — a clean bill of health that got less
  // true the longer DAX was used. Measured at roughly 15ms per hundred runs,
  // which is the right trade for a scan whose whole job is to not miss one.
  // RunStore.list still enumerates the runs on disk, but its stored status is no
  // longer authoritative — the log is. Re-project each one so a run closed out
  // through the event path stops being reported as stranded.
  const listed = await RunStore.list(Number.MAX_SAFE_INTEGER).catch(() => [] as RunState[])
  const states = (
    await Promise.all(
      listed.map(async (stored) => {
        const projected = (await loadRecoveryAuthoritySource(stored.runId)).state
        if (!projected) return stored
        // Status comes from the log, which is authoritative. `updatedAt` comes
        // from the stored row, which records when the run was last touched on
        // disk — the projection's timestamp is the last event's, and a run whose
        // process died stops producing events precisely when it strands.
        return { ...projected, updatedAt: stored.updatedAt }
      }),
    )
  ) as RunState[]
  return states.filter((state) => {
    if (isTerminalStatus(state.status)) return false
    return now - new Date(state.updatedAt).getTime() > INTERRUPTED_RUN_THRESHOLD_MS
  })
}

/**
 * Close out a stranded run honestly.
 *
 * Marked `failed`, not `cancelled`. Cancellation implies somebody decided to
 * stop; a process that died decided nothing. `retryable` is true because the
 * work itself was never rejected, only interrupted.
 */
export async function markRunInterrupted(runId: string): Promise<RunState | undefined> {
  const state = (await loadRecoveryAuthoritySource(runId)).state
  if (!state || isTerminalStatus(state.status)) return undefined

  const { RunLifecycle } = await import("./run-lifecycle")
  return RunLifecycle.transition(runId, "failed", "run_failed", {
    error: {
      code: "run_interrupted",
      message: `Run stopped without completing while in "${state.status}". Its process is gone.`,
      retryable: true,
    },
  })
}

/**
 * Checks if a run appears interrupted and might need recovery.
 */
export async function needsRecovery(runId: string): Promise<boolean> {
  const state = (await loadRecoveryAuthoritySource(runId)).state
  if (!state) return true // No state = needs recovery

  // Non-terminal state without recent activity might need recovery
  if (!isTerminalStatus(state.status)) {
    // Same threshold listInterruptedRuns uses; two different staleness rules
    // in one file is how they drift apart.
    if (Date.now() - new Date(state.updatedAt).getTime() > INTERRUPTED_RUN_THRESHOLD_MS) {
      return true
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
  const source = await loadRecoveryAuthoritySource(runId)
  const state = source.state
  const eventCount =
    source.kind === "event-log"
      ? (await readRunEvents(runId)).length
      : (await RunGateway.replayEvents(runId)).length

  return {
    hasState: !!state,
    isTerminal: state ? isTerminalStatus(state.status) : false,
    needsRecovery: await needsRecovery(runId),
    eventCount,
  }
}
