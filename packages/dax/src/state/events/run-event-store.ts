import { Storage } from "@/storage/storage"
import { parseRunEventLog, RunEventPayloadSchema, type RunEventPayload } from "./run-event-types"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { acquireRunLock } from "@/util/fs-lock"
import type { RunEventEnvelope } from "./run-event-types"
import { reduceRunState, type CanonicalRunState, type RunState } from "./run-reducer"
import { readRunState } from "@/state/run-store"

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

async function readValidatedEvents(runId: string, eventsPath: string[]): Promise<RunEventEnvelope[]> {
  try {
    const persistedEvents = await Storage.read<unknown>(eventsPath)
    if (!Array.isArray(persistedEvents)) throw new Error(`Invalid event log for run ${runId}: expected an array`)
    return parseRunEventLog(runId, persistedEvents)
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return []
    }
    throw error
  }
}

async function appendRunEventUnderLock(input: {
  runId: string
  expectedSeq: number
  event: NewRunEvent
  existingEvents: RunEventEnvelope[]
  eventsPath: string[]
  tempPath: string[]
  rejectDuplicateCommand?: boolean
}): Promise<RunEventEnvelope> {
  const { runId, expectedSeq, event, existingEvents, eventsPath, tempPath, rejectDuplicateCommand } = input
  const actualSeq = existingEvents.length
  if (actualSeq !== expectedSeq) {
    throw new StaleAppendError(runId, expectedSeq, actualSeq)
  }

  if (event.commandId) {
    const existingCommand = existingEvents.find((candidate) => candidate.commandId === event.commandId)
    if (existingCommand) {
      if (rejectDuplicateCommand) {
        throw new DuplicateCommandError(runId, event.commandId)
      }
      log.info("duplicate command detected, returning existing event", {
        runId,
        commandId: event.commandId,
        existingEventId: existingCommand.eventId,
      })
      return existingCommand
    }
  }

  const newEvent: RunEventEnvelope = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    runId,
    seq: expectedSeq,
    type: event.type,
    payload: event.payload,
    occurredAt: new Date().toISOString(),
    schemaVersion: "v1",
    ...(event.causationId ? { causationId: event.causationId } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.commandId ? { commandId: event.commandId } : {}),
  }

  // Validate the write-side boundary as well as storage reads. This prevents
  // a malformed in-process event from becoming durable evidence that a later
  // projection would have to reject.
  const validatedNewEvent = parseRunEventLog(runId, [newEvent])[0]

  // Authority records must not become contradictory durable history. Validate
  // their reducer semantics while the run lock is held, before persistence;
  // projection after the write is too late because the canonical log would
  // already be poisoned.
  if (
    event.type === "approval_requested" ||
    event.type === "approval_resolved" ||
    event.type === "tool_invocation_recorded" ||
    event.type === "authorization_recorded" ||
    event.type === "tool_result_recorded" ||
    event.type === "mutation_recorded"
  ) {
    reduceRunState([...existingEvents, validatedNewEvent])
  }
  existingEvents.push(validatedNewEvent)

  await Storage.write(tempPath, existingEvents)
  await Storage.rename(tempPath, eventsPath)

  log.info("appended event", { runId, seq: expectedSeq, type: event.type })
  return validatedNewEvent
}

export async function appendRunEvent(
  runId: string,
  expectedSeq: number,
  event: NewRunEvent,
): Promise<RunEventEnvelope> {
  const pathParts = await eventPath(runId)
  const eventsPath = [...pathParts, "events.json"]
  const tempPath = [...pathParts, "events.json.tmp"]

  const fsLock = await acquireRunLock(runId)
  try {
    const existingEvents = await readValidatedEvents(runId, eventsPath)
    return await appendRunEventUnderLock({ runId, expectedSeq, event, existingEvents, eventsPath, tempPath })
  } finally {
    await fsLock.dispose()
  }
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
  const pathParts = await eventPath(runId)
  const eventsPath = [...pathParts, "events.json"]
  const tempPath = [...pathParts, "events.json.tmp"]

  const fsLock = await acquireRunLock(runId)
  try {
    const existingEvents = await readValidatedEvents(runId, eventsPath)
    return await appendRunEventUnderLock({
      runId,
      expectedSeq: existingEvents.length,
      event,
      existingEvents,
      eventsPath,
      tempPath,
      rejectDuplicateCommand: options?.rejectDuplicateCommand,
    })
  } finally {
    await fsLock.dispose()
  }
}

export async function readRunEvents(runId: string): Promise<RunEventEnvelope[]> {
  const path = await eventPath(runId)
  const fullPath = [...path, "events.json"]

  try {
    const events = await Storage.read<unknown[]>(fullPath)
    // The read is where the log crosses back into the process. Validating here
    // means every projection downstream is working from a log that has actually
    // been checked, rather than one TypeScript was told to trust.
    return events ? parseRunEventLog(runId, events) : []
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return []
    }
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
  const base = await eventPath(runId)
  await appendRunEventUnderLock({
    runId,
    expectedSeq: 0,
    event: { type: "contract_compiled", payload },
    existingEvents: [],
    eventsPath: [...base, "events.json"],
    tempPath: [...base, "events.json.tmp"],
  })
}

/** Establish authority with a durable recipe for an interrupted first append. */
export async function initializeRunEventAuthority(runId: string, input: Initialization): Promise<void> {
  const payload = parseInitialization(input)
  const lock = await acquireRunLock(runId)
  try {
    const record = await readAuthorityRecord(runId)
    const events = await readValidatedEvents(runId, [...(await eventPath(runId)), "events.json"])
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
    const events = await readValidatedEvents(runId, [...(await eventPath(runId)), "events.json"])
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
