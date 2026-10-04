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

type NewRunEvent = Omit<
  RunEventEnvelope,
  "eventId" | "runId" | "seq" | "occurredAt" | "schemaVersion" | "scopeType" | "scopeId"
>

async function runJournal(
  runId: string,
  initialVersion: "v1" | "v2" = "v2",
): Promise<Journal<RunEventEnvelope, NewRunEvent>> {
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
    create: (seq, event, existing) => {
      // A run's format is fixed at birth. Historical journals are never
      // rewritten or partly upgraded by a later development binary.
      const version = existing[0]?.schemaVersion ?? initialVersion
      for (const key of ["schemaVersion", "runId", "scopeType", "scopeId"]) {
        if (Object.hasOwn(event, key)) throw new Error(`Run envelope field ${key} is store-owned`)
      }
      if (version === "v1" && event.sourceRefs !== undefined) {
        throw new Error("Historical v1 run envelopes cannot carry source references")
      }
      const envelope = {
        eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        runId,
        seq,
        type: event.type,
        payload: event.payload,
        occurredAt: new Date().toISOString(),
        ...(event.causationId ? { causationId: event.causationId } : {}),
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        ...(event.commandId ? { commandId: event.commandId } : {}),
      }
      return version === "v1"
        ? { ...envelope, schemaVersion: "v1" }
        : {
            ...envelope,
            schemaVersion: "v2",
            scopeType: "run",
            scopeId: runId,
            ...(event.sourceRefs === undefined ? {} : { sourceRefs: event.sourceRefs }),
          }
    },
    // Authority records must be valid under the run lock before persistence.
    // A type whose reducer case can reject belongs in this list: otherwise it is
    // written first and rejected on the next read, and the journal stops replaying.
    validateAppend: async (existing, candidate) => {
      validateEnvelopeRecipe(runId, await readAuthorityRecord(runId), [...existing, candidate])
      if (
        candidate.type === "execution_started" ||
        candidate.type === "workflow_started" ||
        candidate.type === "approval_requested" ||
        candidate.type === "approval_resolved" ||
        candidate.type === "tool_invocation_recorded" ||
        candidate.type === "capability_resolution_recorded" ||
        candidate.type === "grant_review_published" ||
        candidate.type === "grant_review_activated" ||
        candidate.type === "grant_ask_remembered" ||
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

/**
 * Review presence only, never executable authority. A failed authority-marker
 * read cannot erase review history or change legacy shadow failure isolation.
 * Shared Journal.read validates ownership, schema, sequence and event IDs;
 * replay validates the payload chains. Execution still uses readRunEvents and
 * its separate authority recipe check. This read does not repair or lock.
 */
export async function hasJournaledGrantReview(runId: string): Promise<boolean> {
  const events = await (await runJournal(runId)).read()
  if (!events.length) {
    // A failed genesis append can leave only the durable recipe. Strict marker
    // reads refuse uncertainty; an actual absent or valid ordinary marker does
    // not invent reviewed authority. No repair, mutation or lock occurs here.
    const record = await readAuthorityRecord(runId)
    if (!record || record.authority === "legacy" || record.initialization === undefined) return false
    return parseInitialization(record.initialization, true).grantReviewIntent === "reviewed_grants"
  }
  const state = reduceRunState(events)
  if (!state) throw new Error(`Run ${runId} has events without a canonical birth; review absence is unproven`)
  if (
    state.grantReview.intent ||
    Object.keys(state.grantReview.requests).length ||
    state.grantReview.published ||
    state.grantReview.activated
  )
    return true
  // Positive recipe evidence cannot be erased by losing a private reservation
  // and removing intent from birth. Only this marker read has legacy failure
  // isolation, after strict shared-Journal parsing and non-review replay succeed.
  let record: AuthorityRecord | null
  try {
    record = await readAuthorityRecord(runId)
  } catch (error) {
    log.warn("non-review journal retains legacy marker-read isolation", { runId, error })
    return false
  }
  const recipe = record?.initialization as { grantReviewIntent?: unknown } | undefined
  // Malformed supplied review intent is still presence, never an ordinary run.
  return recipe?.grantReviewIntent !== undefined
}

export async function readRunEvents(runId: string): Promise<RunEventEnvelope[]> {
  try {
    const events = await (await runJournal(runId)).read()
    validateEnvelopeRecipe(runId, await readAuthorityRecord(runId), events)
    return events
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
type AuthorityRecord = { authority: RunAuthority; initialization?: unknown; envelopeVersion?: "v1" | "v2" }

function validateEnvelopeRecipe(runId: string, record: AuthorityRecord | null, events: RunEventEnvelope[]): void {
  // A historical durable initialization recipe without a version is v1. Do
  // not let a direct append race recovery and invent a different birth format.
  const expected = record?.envelopeVersion ?? (record?.initialization === undefined ? undefined : "v1")
  if (events.length && expected && events[0].schemaVersion !== expected) {
    throw new Error(`Conflicting initialization envelope version for run ${runId}`)
  }
  if (events.length && events[0].type === "contract_compiled") {
    const birth = parseInitialization(events[0].payload)
    const rawRecipe = record?.initialization as { grantReviewIntent?: unknown } | undefined
    // Reviewed birth cannot be erased or supplied only by a mutable marker.
    // Historical ordinary births without this field retain their old recipe semantics.
    if (birth.grantReviewIntent || rawRecipe?.grantReviewIntent !== undefined) {
      const recipe = record?.initialization === undefined ? undefined : parseInitialization(record.initialization, true)
      if (record?.authority !== "event-log" || !recipe || JSON.stringify(recipe) !== JSON.stringify(birth)) {
        throw new Error(`Conflicting reviewed initialization intent for run ${runId}`)
      }
    }
  }
}

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
    if (record.envelopeVersion !== undefined && record.envelopeVersion !== "v1" && record.envelopeVersion !== "v2") {
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
    ...(event.payload.grantReviewIntent ? { grantReviewIntent: event.payload.grantReviewIntent } : {}),
  }
}

async function appendInitializationUnderLock(
  runId: string,
  payload: Initialization,
  version: "v1" | "v2",
): Promise<void> {
  await (await runJournal(runId, version)).appendUnderLock(0, { type: "contract_compiled", payload }, [])
}

/** Establish authority with a durable recipe for an interrupted first append. */
export async function initializeRunEventAuthority(runId: string, input: Initialization): Promise<void> {
  const payload = parseInitialization(input)
  const lock = await acquireRunLock(runId)
  try {
    const record = await readAuthorityRecord(runId)
    const events = await (await runJournal(runId)).read()
    validateEnvelopeRecipe(runId, record, events)
    if (record?.authority === "legacy") throw new Error(`Run ${runId} already has legacy authority`)
    if (events.length > 0) {
      if (record?.authority !== "event-log" || events[0].type !== "contract_compiled") {
        throw new Error(`Cannot initialize inconsistent authority for run ${runId}`)
      }
      if (JSON.stringify(parseInitialization(events[0].payload)) !== JSON.stringify(payload)) {
        throw new Error(`Conflicting initialization for run ${runId}`)
      }
      if (record.envelopeVersion && record.envelopeVersion !== events[0].schemaVersion) {
        throw new Error(`Conflicting initialization envelope version for run ${runId}`)
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
      await writeAuthorityRecord(runId, { authority: "event-log", initialization: payload, envelopeVersion: "v2" })
    }
    await appendInitializationUnderLock(runId, payload, record ? (record.envelopeVersion ?? "v1") : "v2")
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
    validateEnvelopeRecipe(runId, record, events)
    if (events.length > 0 || record.initialization === undefined) return
    await appendInitializationUnderLock(
      runId,
      parseInitialization(record.initialization, true),
      record.envelopeVersion ?? "v1",
    )
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
