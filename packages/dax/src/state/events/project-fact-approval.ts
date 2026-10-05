import z from "zod"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import type { ProjectEventPayload } from "./project-event-types"

export const ProjectFactApprovalSubjectSchema = z.object({
  kind: z.literal("project_fact_change"),
  projectId: z.string().min(1),
  commandId: z.string().min(1),
  action: z.enum(["project_fact_promoted", "project_fact_superseded", "project_fact_retired", "project_settings_adopted", "project_settings_replaced"]),
  canonicalization: z.literal("sorted-json-v1"),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict()

export type ProjectFactApprovalSubject = z.infer<typeof ProjectFactApprovalSubjectSchema>

/** Commits to exactly the fact change without copying its text into the run log. */
export async function projectFactApprovalSubject(input: {
  projectId: string
  commandId: string
  change: Exclude<ProjectEventPayload, { type: "project_initialized" }>
}): Promise<ProjectFactApprovalSubject> {
  const commitment = await computeCanonicalCommitment(input.change)
  return {
    kind: "project_fact_change",
    projectId: input.projectId,
    commandId: input.commandId,
    action: input.change.type,
    canonicalization: commitment.canonicalization,
    digest: commitment.digest,
  }
}
