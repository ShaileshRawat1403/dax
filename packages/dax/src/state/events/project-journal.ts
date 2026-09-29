import { Instance } from "@/project/instance"
import { acquireProjectLock } from "@/util/fs-lock"
import { getRunAuthority, readRunEvents } from "./run-event-store"
import { Journal } from "./journal"
import { parseProjectEventLog, type ProjectEventEnvelope, type ProjectEventPayload } from "./project-event-types"
import { reduceProjectState, type ProjectState } from "./project-reducer"
import type { JournalEventReference } from "./scope-envelope"
import { projectFactApprovalSubject } from "./project-fact-approval"
import { reduceRunState } from "./run-reducer"
import type { RunEventEnvelope, RunEventPayload } from "./run-event-types"

type NewProjectEvent = ProjectEventPayload & { sourceRefs?: JournalEventReference[]; commandId?: string }

export class ProjectFactAuthorizationError extends Error {
  readonly code = "project_fact_authorization_required"
  constructor() {
    super("project_fact_authorization_required")
    this.name = "ProjectFactAuthorizationError"
  }
}

function projectJournal(): Journal<ProjectEventEnvelope, NewProjectEvent> {
  const projectId = Instance.project.id
  return new Journal<ProjectEventEnvelope, NewProjectEvent>({
    scope: { type: "project", id: projectId },
    path: ["project_events", projectId],
    lock: () => acquireProjectLock(projectId),
    parse: (raw) => parseProjectEventLog(projectId, raw),
    create: (seq, input) => ({
      eventId: `pevt_${crypto.randomUUID()}`,
      projectId,
      seq,
      type: input.type,
      payload: input.payload,
      occurredAt: new Date().toISOString(),
      schemaVersion: "v1",
      scopeType: "project",
      scopeId: projectId,
      ...(input.sourceRefs ? { sourceRefs: input.sourceRefs } : {}),
      ...(input.commandId ? { commandId: input.commandId } : {}),
    }) as ProjectEventEnvelope,
    validateAppend: async (existing, candidate) => {
      if (candidate.type !== "project_initialized") {
        const sources = await verifySourceReferences(existing, candidate.sourceRefs ?? [])
        await verifyApprovedChange(candidate, sources)
      }
      reduceProjectState([...existing, candidate])
    },
    staleError: (expected, actual) =>
      new Error(`Stale project journal append: expected seq ${expected}, found ${actual}`),
    duplicateError: (commandId) => new Error(`Duplicate project journal command ${commandId}`),
  })
}

export async function readProjectEvents(): Promise<ProjectEventEnvelope[]> {
  const events = await projectJournal().read()
  reduceProjectState(events)
  return events
}

export async function projectStateFromEvents(): Promise<ProjectState | null> {
  return reduceProjectState(await readProjectEvents())
}

/** A failed first write leaves no authority; a retry writes exactly one genesis. */
export async function initializeProjectJournal(): Promise<void> {
  const projectId = Instance.project.id
  const lock = await acquireProjectLock(projectId)
  try {
    const journal = projectJournal()
    const existing = await journal.read()
    if (existing.length) {
      reduceProjectState(existing)
      return
    }
    await journal.appendUnderLock(0, {
      type: "project_initialized",
      payload: {},
      commandId: `project_genesis_${projectId}`,
    }, [])
  } finally {
    await lock.dispose()
  }
}

async function verifySourceReferences(
  existing: ProjectEventEnvelope[],
  refs: JournalEventReference[],
): Promise<Map<string, RunEventEnvelope[]>> {
  const projectId = Instance.project.id
  const runSources = new Map<string, RunEventEnvelope[]>()
  for (const ref of refs) {
    if (ref.scopeType === "project") {
      if (ref.scopeId !== projectId || !existing.some((event) => event.eventId === ref.eventId)) {
        throw new Error("Project provenance source is not in the governing project journal")
      }
      continue
    }
    if ((await getRunAuthority(ref.scopeId)) !== "event-log") {
      throw new Error("Run provenance source lacks canonical event authority")
    }
    let runEvents = runSources.get(ref.scopeId)
    if (!runEvents) {
      runEvents = await readRunEvents(ref.scopeId)
      reduceRunState(runEvents)
      runSources.set(ref.scopeId, runEvents)
    }
    if (!runEvents.some((event) => event.eventId === ref.eventId)) {
      throw new Error("Run provenance source is absent from its canonical journal")
    }
  }
  return runSources
}

async function verifyApprovedChange(
  candidate: Exclude<ProjectEventEnvelope, { type: "project_initialized" }>,
  sources: Map<string, RunEventEnvelope[]>,
): Promise<void> {
  if (!candidate.commandId) throw new ProjectFactAuthorizationError()
  const expected = await projectFactApprovalSubject({
    projectId: candidate.projectId,
    commandId: candidate.commandId,
    change: { type: candidate.type, payload: candidate.payload } as Exclude<ProjectEventPayload, { type: "project_initialized" }>,
  })
  for (const ref of candidate.sourceRefs ?? []) {
    if (ref.scopeType !== "run") continue
    const events = sources.get(ref.scopeId) ?? []
    const resolution = events.find((event) => event.eventId === ref.eventId)
    if (resolution?.type !== "approval_resolved") continue
    const resolved = resolution.payload as Extract<RunEventPayload, { type: "approval_resolved" }>["payload"]
    if (resolved.decision !== "approved" || !resolved.actor?.trim()) continue
    const requested = events.find((event) =>
      event.type === "approval_requested" &&
      (event.payload as Extract<RunEventPayload, { type: "approval_requested" }>["payload"]).approvalId === resolved.approvalId,
    )
    if (!requested || requested.seq >= resolution.seq) continue
    const request = requested.payload as Extract<RunEventPayload, { type: "approval_requested" }>["payload"]
    if (request.approvalType !== "workflow_gate" || !request.projectFactSubject) continue
    const actual = request.projectFactSubject
    if (
      actual.kind === expected.kind &&
      actual.projectId === expected.projectId &&
      actual.commandId === expected.commandId &&
      actual.action === expected.action &&
      actual.canonicalization === expected.canonicalization &&
      actual.digest === expected.digest
    ) return
  }
  throw new ProjectFactAuthorizationError()
}

/** Trusted storage boundary; user/model authority is enforced by its producer. */
export async function appendProjectEvent(input: Exclude<NewProjectEvent, { type: "project_initialized" }>): Promise<ProjectEventEnvelope> {
  if (!input.commandId) throw new Error("Project journal changes require a command ID")
  if (!input.sourceRefs?.length) throw new Error("Project journal changes require provenance references")
  const projectId = Instance.project.id
  const lock = await acquireProjectLock(projectId)
  try {
    const journal = projectJournal()
    const existing = await journal.read()
    const inputs: NewProjectEvent[] = existing.length
      ? [input]
      : [{ type: "project_initialized", payload: {}, commandId: `project_genesis_${projectId}` }, input]
    const results = await journal.appendBatchUnderLock(existing.length, inputs, existing, { rejectDuplicateCommand: true })
    return results[results.length - 1]
  } finally {
    await lock.dispose()
  }
}
