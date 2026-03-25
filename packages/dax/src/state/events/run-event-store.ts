import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { RunEventEnvelope } from "./run-event-types"
import { reduceRunState, type RunState } from "./run-reducer"

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

export async function appendRunEvent(
  runId: string,
  expectedSeq: number,
  event: Omit<RunEventEnvelope, "eventId" | "runId" | "seq" | "occurredAt" | "schemaVersion">,
): Promise<RunEventEnvelope> {
  const path = await eventPath(runId)
  const fullPath = [...path, "events.json"]

  let existingEvents: RunEventEnvelope[] = []
  try {
    existingEvents = (await Storage.read<RunEventEnvelope[]>(fullPath)) ?? []
  } catch (error) {
    if (!Storage.NotFoundError.isInstance(error)) {
      throw error
    }
  }

  const actualSeq = existingEvents.length
  if (actualSeq !== expectedSeq) {
    throw new StaleAppendError(runId, expectedSeq, actualSeq)
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

  existingEvents.push(newEvent)
  await Storage.write(fullPath, existingEvents)

  log.info("appended event", { runId, seq: expectedSeq, type: event.type })
  return newEvent
}

export async function readRunEvents(runId: string): Promise<RunEventEnvelope[]> {
  const path = await eventPath(runId)
  const fullPath = [...path, "events.json"]

  try {
    const events = await Storage.read<RunEventEnvelope[]>(fullPath)
    return events ?? []
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return []
    }
    log.error("failed to read run events", { error, runId })
    throw error
  }
}

export async function projectRunStateFromEvents(runId: string): Promise<RunState | null> {
  const events = await readRunEvents(runId)
  if (events.length === 0) {
    return null
  }
  return reduceRunState(events)
}

export async function getRunAuthority(runId: string): Promise<RunAuthority | null> {
  const path = await authorityPath(runId)
  const fullPath = [...path, "authority.json"]

  try {
    const result = await Storage.read<{ authority: RunAuthority }>(fullPath)
    return result?.authority ?? null
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
