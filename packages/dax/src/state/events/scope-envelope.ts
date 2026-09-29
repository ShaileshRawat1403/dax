import z from "zod"

const ScopeIdSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, "must be an opaque storage-safe scope ID")

/** Identifies evidence without transferring ownership of its state transition. */
export const JournalEventReferenceSchema = z.object({
  scopeType: z.enum(["run", "project"]),
  scopeId: ScopeIdSchema,
  eventId: z.string().min(1),
}).strict()

export type JournalEventReference = z.infer<typeof JournalEventReferenceSchema>

export const ScopedEnvelopeFields = {
  scopeType: z.enum(["run", "project"]),
  scopeId: ScopeIdSchema,
  sourceRefs: z.array(JournalEventReferenceSchema).max(16).optional(),
} as const

export function validateSourceReferences(
  owner: { scopeType: "run" | "project"; scopeId: string; eventId: string; sourceRefs?: JournalEventReference[] },
): string | null {
  const seen = new Set<string>()
  for (const ref of owner.sourceRefs ?? []) {
    if (ref.scopeType === owner.scopeType && ref.scopeId === owner.scopeId && ref.eventId === owner.eventId) {
      return "an event cannot cite itself as a source"
    }
    const key = `${ref.scopeType}\0${ref.scopeId}\0${ref.eventId}`
    if (seen.has(key)) return "sourceRefs cannot contain duplicates"
    seen.add(key)
  }
  return null
}
