import { readProjectEvents } from "@/state/events/project-journal"
import { reduceProjectState } from "@/state/events/project-reducer"
import type { ProjectFact } from "@/state/events/project-event-types"

/** A pure journal projection: no SQLite import, approval inference or fallback. */
export async function readApprovedProjectMemory(input: {
  project_id: string
  category?: ProjectFact["category"]
  limit: number
}) {
  const events = await readProjectEvents(input.project_id)
  const state = reduceProjectState(events)
  const entries = Object.values(state?.facts ?? {})
    .filter((fact) => fact.kind === "memory" && fact.status === "active" &&
      (!input.category || fact.category === input.category))
    .map((fact) => {
      const event = events.find((event) => event.eventId === fact.promotedEventId)!
      const created_at = Date.parse(event.occurredAt)
      if (!Number.isFinite(created_at)) throw new Error("Project memory has an invalid promotion timestamp")
      return {
        id: fact.factId,
        project_id: input.project_id,
        session_id: null,
        category: fact.category!,
        title: fact.title,
        content: fact.content,
        tags: [...fact.tags],
        // This names the projection producer, not the original fact author.
        source: "system" as const,
        created_at,
        event_id: fact.promotedEventId,
        source_refs: fact.sourceRefs.map((ref) => ({ ...ref })),
        sequence: event.seq,
      }
    })
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, input.limit)
  return {
    coverage: state ? "journal" as const : "unavailable" as const,
    revision: state?.revision ?? null,
    entries,
  }
}
