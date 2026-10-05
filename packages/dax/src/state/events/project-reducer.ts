import type { ProjectSettingsSnapshot } from "./project-settings"
import type { JournalEventReference } from "./scope-envelope"
import type { ProjectEventEnvelope, ProjectFact } from "./project-event-types"

export type ProjectFactRecord = ProjectFact & {
  status: "active" | "superseded" | "retired"
  promotedEventId: string
  sourceRefs: JournalEventReference[]
  supersededBy: string | null
  retiredEventId: string | null
}

export type ProjectState = {
  projectId: string
  initializedAt: string
  revision: number
  facts: Record<string, ProjectFactRecord>
  settings?: { snapshot: ProjectSettingsSnapshot; adoptedEventId: string; updatedEventId: string; updatedAt: string }
}

/** Project facts are owned by this sequence, never copied into the source run. */
export function reduceProjectState(events: ProjectEventEnvelope[]): ProjectState | null {
  if (events.length === 0) return null
  const genesis = events[0]
  if (genesis.type !== "project_initialized") throw new Error("First project event must be project_initialized")

  const state: ProjectState = {
    projectId: genesis.projectId,
    initializedAt: genesis.occurredAt,
    revision: 0,
    facts: {},
  }
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) throw new Error(`Project event log is not contiguous: expected seq ${index}`)
    if (event.projectId !== state.projectId || event.scopeId !== state.projectId || event.scopeType !== "project") {
      throw new Error(`Project event ${event.eventId} has a mismatched owner`)
    }
    if (index > 0 && event.type === "project_initialized") throw new Error("Project journal has repeated genesis")

    if (event.type === "project_settings_adopted") {
      if (state.settings) throw new Error("project_settings_already_adopted")
      state.settings = { snapshot: event.payload.snapshot, adoptedEventId: event.eventId,
        updatedEventId: event.eventId, updatedAt: event.occurredAt }
    }
    if (event.type === "project_settings_replaced") {
      if (!state.settings || state.settings.updatedEventId !== event.payload.priorSettingsEventId)
        throw new Error("project_settings_predecessor_mismatch")
      state.settings = { ...state.settings, snapshot: event.payload.snapshot,
        updatedEventId: event.eventId, updatedAt: event.occurredAt }
    }
    if (event.type === "project_fact_promoted") {
      const fact = event.payload.fact
      if (state.facts[fact.factId]) throw new Error(`Project fact ${fact.factId} is already recorded`)
      state.facts[fact.factId] = {
        ...fact,
        status: "active",
        promotedEventId: event.eventId,
        sourceRefs: event.sourceRefs ?? [],
        supersededBy: null,
        retiredEventId: null,
      }
    }
    if (event.type === "project_fact_superseded") {
      const prior = state.facts[event.payload.priorFactId]
      const replacement = event.payload.replacement
      if (!prior || prior.status !== "active") throw new Error("Only an active project fact may be superseded")
      if (state.facts[replacement.factId]) throw new Error(`Project fact ${replacement.factId} is already recorded`)
      prior.status = "superseded"
      prior.supersededBy = replacement.factId
      state.facts[replacement.factId] = {
        ...replacement,
        status: "active",
        promotedEventId: event.eventId,
        sourceRefs: event.sourceRefs ?? [],
        supersededBy: null,
        retiredEventId: null,
      }
    }
    if (event.type === "project_fact_retired") {
      const fact = state.facts[event.payload.factId]
      if (!fact || fact.status !== "active") throw new Error("Only an active project fact may be retired")
      fact.status = "retired"
      fact.retiredEventId = event.eventId
    }
    state.revision = event.seq
  }
  return state
}
