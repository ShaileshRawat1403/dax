import z from "zod"
import { ScopedEnvelopeFields, validateSourceReferences } from "./scope-envelope"

const canonicalText = (maximum: number) =>
  z.string().min(1).max(maximum).refine((value) => value === value.trim(), "must not have outer whitespace")

const ProjectFactSchema = z.object({
  factId: z.string().min(1),
  kind: z.enum(["memory", "convention"]),
  category: z.enum(["architecture", "decision", "pattern", "preference", "learning"]).optional(),
  title: canonicalText(256),
  content: canonicalText(16_384),
  tags: z.array(canonicalText(64)).max(16),
}).strict().superRefine((fact, ctx) => {
  if (fact.kind === "memory" && !fact.category) {
    ctx.addIssue({ code: "custom", path: ["category"], message: "memory facts require a category" })
  }
  if (fact.kind === "convention" && fact.category) {
    ctx.addIssue({ code: "custom", path: ["category"], message: "conventions do not use memory categories" })
  }
})

export type ProjectFact = z.infer<typeof ProjectFactSchema>

const ProjectEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project_initialized"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("project_fact_promoted"), payload: z.object({ fact: ProjectFactSchema }).strict() }),
  z.object({
    type: z.literal("project_fact_superseded"),
    payload: z.object({ priorFactId: z.string().min(1), replacement: ProjectFactSchema }).strict(),
  }),
  z.object({
    type: z.literal("project_fact_retired"),
    payload: z.object({ factId: z.string().min(1), reason: canonicalText(1024) }).strict(),
  }),
])

export type ProjectEventPayload = z.infer<typeof ProjectEventPayloadSchema>

export const ProjectEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  occurredAt: z.string().min(1),
  schemaVersion: z.literal("v1"),
  scopeType: z.literal("project"),
  scopeId: ScopedEnvelopeFields.scopeId,
  sourceRefs: ScopedEnvelopeFields.sourceRefs,
  commandId: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
}).strict().and(ProjectEventPayloadSchema).superRefine((event, ctx) => {
  if (event.scopeId !== event.projectId) {
    ctx.addIssue({ code: "custom", path: ["scopeId"], message: "must equal projectId" })
  }
  const referenceError = validateSourceReferences(event)
  if (referenceError) ctx.addIssue({ code: "custom", path: ["sourceRefs"], message: referenceError })
  if (event.type === "project_initialized") {
    if (event.sourceRefs?.length) {
      ctx.addIssue({ code: "custom", path: ["sourceRefs"], message: "genesis cannot cite source events" })
    }
  } else if (!event.sourceRefs?.length) {
    ctx.addIssue({ code: "custom", path: ["sourceRefs"], message: "project transitions require provenance" })
  }
})

export type ProjectEventEnvelope = z.infer<typeof ProjectEventEnvelopeSchema>

export function parseProjectEventLog(projectId: string, raw: unknown[]): ProjectEventEnvelope[] {
  return raw.map((value, index) => {
    const result = ProjectEventEnvelopeSchema.safeParse(value)
    if (!result.success) {
      throw new Error(
        `Project ${projectId} has a malformed event at position ${index}: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
          .join("; ")}. Refusing to project an unreadable log.`,
      )
    }
    if (result.data.projectId !== projectId) {
      throw new Error(`Project ${projectId} journal contains event owned by ${result.data.projectId}`)
    }
    return result.data
  })
}
