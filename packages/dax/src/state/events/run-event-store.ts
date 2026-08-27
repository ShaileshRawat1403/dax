import { Storage } from "@/storage/storage"
import { parseRunEventLog } from "./run-event-types"
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
    const persistedEvents = await Storage.read<unknown[]>(eventsPath)
    return persistedEvents ? parseRunEventLog(runId, persistedEvents) : []
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
}): Promise<RunEventEnvelope> {
  const { runId, expectedSeq, event, existingEvents, eventsPath, tempPath } = input
  const actualSeq = existingEvents.length
  if (actualSeq !== expectedSeq) {
    throw new StaleAppendError(runId, expectedSeq, actualSeq)
  }

  if (event.commandId) {
    const existingCommand = existingEvents.find((candidate) => candidate.commandId === event.commandId)
    if (existingCommand) {
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
export async function appendRunEventAtTail(runId: string, event: NewRunEvent): Promise<RunEventEnvelope> {
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

export async function getRunAuthority(runId: string): Promise<RunAuthority | null> {
  const path = await authorityPath(runId)
  const fullPath = [...path, "authority.json"]

  try {
    const result = await Storage.read<unknown>(fullPath)
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new InvalidRunAuthorityError(runId, result)
    }

    const authority = (result as { authority?: unknown }).authority
    if (authority !== "legacy" && authority !== "event-log") {
      throw new InvalidRunAuthorityError(runId, result)
    }

    return authority
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return null
    }
    log.error("failed to read run authority", { error, runId })
    throw error
  }
}

export async function setRunAuthority(runId: string, authority: RunAuthority): Promise<void> {
  const path = await authorityPath(runId)
  const fullPath = [...path, "authority.json"]

  await Storage.write(fullPath, { authority })
  log.info("set run authority", { runId, authority })
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
