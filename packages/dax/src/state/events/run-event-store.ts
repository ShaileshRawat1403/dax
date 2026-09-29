import { Storage } from "@/storage/storage"
import { parseRunEventLog, RunEventPayloadSchema, type RunEventPayload } from "./run-event-types"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { acquireRunLock } from "@/util/fs-lock"
import type { RunEventEnvelope } from "./run-event-types"
import { reduceRunState, type CanonicalRunState, type RunState } from "./run-reducer"
import { readRunState } from "@/state/run-store"
import { Journal } from "./journal"

const log = Log.create({ service: "event-store" })

export type RunAuthority = "legacy" | "event-log"

async function eventPath(runId: string): Promise<string[]> {
  return ["run_events", Instance.project.id, runId]
}

async function authorityPath(runId: string): Promise<string[]> {
  return ["run_authority", Instance.project.id, runId]
}

export class StaleAppendError extends Error {
  constructor(
    public readonly runId: string,
    public readonly expectedSeq: number,
    public readonly actualSeq: number,
  ) {
    super(`Stale append for run ${runId}: expected seq ${expectedSeq}, found ${actualSeq}`)
    this.name = "StaleAppendError"
  }
}

export class DuplicateCommandError extends Error {
  constructor(
    public readonly runId: string,
    public readonly commandId: string,
  ) {
    super(`Duplicate command ${commandId} for run ${runId}`)
    this.name = "DuplicateCommandError"
  }
}

export class InvalidRunAuthorityError extends Error {
  constructor(
    public readonly runId: string,
    public readonly value: unknown,
  ) {
    super(`Invalid run authority for ${runId}`)
    this.name = "InvalidRunAuthorityError"
  }
}

type NewRunEvent = Omit<RunEventEnvelope, "eventId" | "runId" | "seq" | "occurredAt" | "schemaVersion">

async function runJournal(runId: string): Promise<Journal<RunEventEnvelope, NewRunEvent>> {
  return new Journal<RunEventEnvelope, NewRunEvent>({
    scope: { type: "run", id: runId },
    path: await eventPath(runId),
    lock: () => acquireRunLock(runId),
    parse: (raw) => {
      const events = parseRunEventLog(runId, raw)
      for (const event of events) {
        if (event.runId !== runId) throw new Error(`Run ${runId} journal contains event owned by ${event.runId}`)
      }
      return events
    },
    create: (seq, event) => ({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      runId,
      seq,
      type: event.type,
      payload: event.payload,
      occurredAt: new Date().toISOString(),
      schemaVersion: "v1",
      ...(event.causationId ? { causationId: event.causationId } : {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      ...(event.commandId ? { commandId: event.commandId } : {}),
    }),
    // Authority records must be valid under the run lock before persistence.
    validateAppend: (existing, candidate) => {
      if (
        candidate.type === "approval_requested" ||
        candidate.type === "approval_resolved" ||
        candidate.type === "tool_invocation_recorded" ||
        candidate.type === "authorization_recorded" ||
        candidate.type === "delegation_recorded" ||
        candidate.type === "assistant_recording_started" ||
        candidate.type === "assistant_message_recorded" ||
        candidate.type === "compaction_recording_started" ||
        candidate.type === "compaction_attempt_bound" ||
        candidate.type === "compaction_attempt_closed" ||
        candidate.type === "compaction_replacement_recorded" ||
        candidate.type === "prompt_recording_started" ||
        candidate.type === "prompt_contribution_recorded" ||
        candidate.type === "context_recording_started" ||
        candidate.type === "context_contribution_recorded" ||
        candidate.type === "tool_result_recorded" ||
        candidate.type === "mutation_recorded" ||
        candidate.type === "run_completed" ||
        candidate.type === "workflow_completed"
      ) {
        reduceRunState([...existing, candidate])
      }
    },
    staleError: (expected, actual) => new StaleAppendError(runId, expected, actual),
    duplicateError: (commandId) => new DuplicateCommandError(runId, commandId),
  })
}

export async function appendRunEvent(
  runId: string,
  expectedSeq: number,
  event: NewRunEvent,
): Promise<RunEventEnvelope> {
  const result = await (await runJournal(runId)).append(expectedSeq, event)
  log.info("appended event", { runId, seq: result.seq, type: result.type })
  return result
}

/**
 * Appends to the current validated tail while holding the same filesystem lock
 * used by explicit sequence writes. Normal producers use this path so two
 * concurrent calls serialize instead of racing on a sequence read performed
 * before the lock. appendRunEvent remains the explicit compare-and-swap API.
 */
export async function appendRunEventAtTail(
  runId: string,
  event: NewRunEvent,
  options?: { rejectDuplicateCommand?: boolean },
): Promise<RunEventEnvelope> {
  const result = await (await runJournal(runId)).appendAtTail(event, options)
  log.info("appended event", { runId, seq: result.seq, type: result.type })
  return result
}

export async function readRunEvents(runId: string): Promise<RunEventEnvelope[]> {
  try {
    return await (await runJournal(runId)).read()
  } catch (error) {
    log.error("failed to read run events", { error, runId })
    throw error
  }
}

export async function projectRunStateFromEvents(runId: string): Promise<CanonicalRunState | null> {
  const events = await readRunEvents(runId)
  if (events.length === 0) {
    return null
  }
  return reduceRunState(events)
}

export async function getProjectedRunState(runId: string): Promise<RunState | null> {
  const authority = await getRunAuthority(runId)

  if (authority === "event-log") {
    return projectRunStateFromEvents(runId)
  }

  if (authority === "legacy" || authority === null) {
    const legacyState = await readRunState(runId)
    if (!legacyState) return null
    return {
      ...legacyState,
      draft: null,
      invocations: {},
      delegationHistory: {
        coverage: "unavailable",
        records: [],
        missingInvocationIds: [],
        uncapturedCreationSessionIds: [],
      },
      assistantHistory: {
        scope: "session_processor_v1",
        coverage: "unavailable",
        sessions: [],
        messages: [],
        unsettledMessageIds: [],
      },
      promptHistory: {
        scope: "session_processor_instructions_v1",
        coverage: "unavailable",
        sessions: [],
        dispatches: [],
        missingMessageIds: [],
      },
      contextHistory: {
        scope: "session_processor_context_v1",
        coverage: "unavailable",
        sessions: [],
        dispatches: [],
        missingMessageIds: [],
      },
      compactionHistory: {
        scope: "session_compaction_replacement_v1",
        coverage: "unavailable",
        sessions: [],
        attempts: [],
        openAttemptEventIds: [],
      },
    } as RunState
  }

  return null
}

type Initialization = Extract<RunEventPayload, { type: "contract_compiled" }>["payload"]
type AuthorityRecord = { authority: RunAuthority; initialization?: unknown }

async function readAuthorityRecord(runId: string): Promise<AuthorityRecord | null> {
  try {
    const result = await Storage.read<unknown>([...(await authorityPath(runId)), "authority.json"])
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new InvalidRunAuthorityError(runId, result)
    }
    const record = result as AuthorityRecord
    if (record.authority !== "legacy" && record.authority !== "event-log") {
      throw new InvalidRunAuthorityError(runId, result)
    }
    return record
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) return null
    log.error("failed to read run authority", { error, runId })
    throw error
  }
}

export async function getRunAuthority(runId: string): Promise<RunAuthority | null> {
  return (await readAuthorityRecord(runId))?.authority ?? null
}

// Caller holds the run lock. Publish the complete marker/intent in one rename,
// so a torn marker write never becomes the durable initialization recipe.
async function writeAuthorityRecord(runId: string, record: AuthorityRecord): Promise<void> {
  const base = await authorityPath(runId)
  const temp = [...base, "authority.json.tmp"]
  await Storage.write(temp, record)
  await Storage.rename(temp, [...base, "authority.json"])
}

export async function setRunAuthority(runId: string, authority: RunAuthority): Promise<void> {
  const lock = await acquireRunLock(runId)
  try {
    const existing = await readAuthorityRecord(runId)
    if (existing?.authority === authority) return
    if (existing?.authority === "event-log") {
      throw new Error(`Cannot replace canonical event authority for run ${runId}`)
    }
    await writeAuthorityRecord(runId, { authority })
  } finally {
    await lock.dispose()
  }
}

function parseInitialization(value: unknown, persisted = false): Initialization {
  const event = RunEventPayloadSchema.parse({ type: "contract_compiled", payload: value })
  if (event.type !== "contract_compiled") throw new Error("Invalid initialization event")
  if (
    persisted &&
    (event.payload.verificationRequired === undefined || event.payload.guardEnforcementMode === undefined)
  ) {
    throw new Error("Incomplete persisted initialization intent")
  }
  // Normalize optional v1 fields when checking retry equivalence.
  return {
    contractId: event.payload.contractId,
    verificationRequired: event.payload.verificationRequired ?? false,
    guardEnforcementMode: event.payload.guardEnforcementMode ?? "warn",
  }
}

async function appendInitializationUnderLock(runId: string, payload: Initialization): Promise<void> {
  await (await runJournal(runId)).appendUnderLock(0, { type: "contract_compiled", payload }, [])
}

/** Establish authority with a durable recipe for an interrupted first append. */
export async function initializeRunEventAuthority(runId: string, input: Initialization): Promise<void> {
  const payload = parseInitialization(input)
  const lock = await acquireRunLock(runId)
  try {
    const record = await readAuthorityRecord(runId)
    const events = await (await runJournal(runId)).read()
    if (record?.authority === "legacy") throw new Error(`Run ${runId} already has legacy authority`)
    if (events.length > 0) {
      if (record?.authority !== "event-log" || events[0].type !== "contract_compiled") {
        throw new Error(`Cannot initialize inconsistent authority for run ${runId}`)
      }
      if (JSON.stringify(parseInitialization(events[0].payload)) !== JSON.stringify(payload)) {
        throw new Error(`Conflicting initialization for run ${runId}`)
      }
      return // Exact retry; do not append a second genesis event.
    }
    if (record) {
      // Older marker-only records lack the settings needed for safe replay.
      if (record.initialization === undefined) throw new Error(`No initialization intent for run ${runId}`)
      if (JSON.stringify(parseInitialization(record.initialization, true)) !== JSON.stringify(payload)) {
        throw new Error(`Conflicting initialization for run ${runId}`)
      }
    } else {
      await writeAuthorityRecord(runId, { authority: "event-log", initialization: payload })
    }
    await appendInitializationUnderLock(runId, payload)
  } finally {
    await lock.dispose()
  }
}

/** Repair only a missing first event with a persisted, validated initialization intent. */
export async function repairRunInitialization(runId: string): Promise<void> {
  const lock = await acquireRunLock(runId)
  try {
    const record = await readAuthorityRecord(runId)
    if (record?.authority !== "event-log") return
    const events = await (await runJournal(runId)).read()
    if (events.length > 0 || record.initialization === undefined) return
    await appendInitializationUnderLock(runId, parseInitialization(record.initialization, true))
  } finally {
    await lock.dispose()
  }
}

export async function hasRunEvents(runId: string): Promise<boolean> {
  const path = await eventPath(runId)
  const fullPath = [...path, "events.json"]

  try {
    await Storage.read(fullPath)
    return true
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return false
    }
    throw error
  }
}

export async function clearRunEvents(runId: string): Promise<void> {
  const path = await eventPath(runId)
  const fullPath = [...path, "events.json"]
  try {
    await Storage.remove(fullPath)
    log.info("cleared run events", { runId })
  } catch (error) {
    if (!Storage.NotFoundError.isInstance(error)) {
      throw error
    }
  }
}
