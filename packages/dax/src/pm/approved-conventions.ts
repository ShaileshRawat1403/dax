import { readProjectEvents } from "@/state/events/project-journal"
import { reduceProjectState } from "@/state/events/project-reducer"

/** Only active operator-reviewed project facts can contribute conventions. */
export async function approvedProjectConventions(projectId: string) {
  const events = await readProjectEvents(projectId)
  const state = reduceProjectState(events)
  const sequence = new Map(events.map((event) => [event.eventId, event.seq]))
  return Object.values(state?.facts ?? {})
    .filter((fact) => fact.kind === "convention" && fact.status === "active")
    .sort((a, b) => sequence.get(a.promotedEventId)! - sequence.get(b.promotedEventId)!)
    .map((fact) => ({
      text: fact.content,
      // Record the opaque authority event, not the potentially private title.
      reference: `project-event:${fact.promotedEventId}`,
    }))
}
