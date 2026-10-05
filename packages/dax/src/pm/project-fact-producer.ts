import z from "zod"
import { Instance } from "@/project/instance"
import { acquireProjectLock } from "@/util/fs-lock"
import type { RunEventEnvelope, RunEventPayload } from "@/state/events/run-event-types"
import { reduceRunState } from "@/state/events/run-reducer"
import { Storage } from "@/storage/storage"
import { ProjectEventPayloadSchema, type ProjectEventPayload } from "@/state/events/project-event-types"
import { projectFactApprovalSubject, ProjectFactApprovalSubjectSchema } from "@/state/events/project-fact-approval"
import { appendRunEventAtTail, readRunEvents } from "@/state/events/run-event-store"
import { appendProjectEvent, readProjectEvents } from "@/state/events/project-journal"

export const ProjectFactChangeSchema = ProjectEventPayloadSchema
  .refine((change) => change.type !== "project_initialized", "genesis is not a fact change")
  .transform((change) => change as Exclude<ProjectEventPayload, { type: "project_initialized" }>)
const CandidateId = z.string().regex(/^pfc_[0-9a-f]{32}$/)
const CandidateSchema = z.object({
  schemaVersion: z.literal("v1"),
  candidateId: CandidateId,
  projectId: z.string().min(1),
  runId: z.string().min(1),
  approvalId: z.string().min(1),
  commandId: z.string().min(1),
  change: ProjectFactChangeSchema,
  subject: ProjectFactApprovalSubjectSchema,
}).strict()
function requests(events: RunEventEnvelope[]) {
  return events.filter((event) => event.type === "approval_requested").map((event) => ({
    event, payload: event.payload as Extract<RunEventPayload, { type: "approval_requested" }>["payload"],
  }))
}
function resolutions(events: RunEventEnvelope[]) {
  return events.filter((event) => event.type === "approval_resolved").map((event) => ({
    event, payload: event.payload as Extract<RunEventPayload, { type: "approval_resolved" }>["payload"],
  }))
}
const key = (id: string) => ["project_fact_candidates", Instance.project.id, CandidateId.parse(id)]

export async function readProjectFactCandidate(candidateId: string) {
  const candidate = CandidateSchema.parse(await Storage.read(key(candidateId)))
  const expected = await projectFactApprovalSubject(candidate)
  if (candidate.candidateId !== candidateId || candidate.projectId !== Instance.project.id ||
    candidate.commandId !== `cmd_${candidateId}` || candidate.approvalId !== `apr_${candidateId}` ||
    JSON.stringify(expected) !== JSON.stringify(candidate.subject)) {
    throw new Error("project_fact_candidate_mismatch")
  }
  return candidate
}

/** Content lives in project storage; the run records only its exact commitment. */
async function proposeProjectFactUnderLock(input: { runId: string; candidateId: string; change: unknown }) {
  const candidateId = CandidateId.parse(input.candidateId)
  const change = ProjectFactChangeSchema.parse(input.change)
  const commandId = `cmd_${candidateId}`
  const subject = await projectFactApprovalSubject({ projectId: Instance.project.id, commandId, change })
  const candidate = CandidateSchema.parse({ schemaVersion: "v1", candidateId,
    projectId: Instance.project.id, runId: input.runId, approvalId: `apr_${candidateId}`, commandId, change, subject })
  // Validate run authority before publishing even a non-authoritative candidate.
  const events = await readRunEvents(input.runId)
  reduceRunState(events)
  if (!events.length) throw new Error("project_fact_run_authority_required")
  try {
    const existing = await readProjectFactCandidate(candidateId)
    if (existing.runId !== input.runId || existing.subject.digest !== subject.digest)
      throw new Error("project_fact_candidate_conflict")
  } catch (error) {
    if (!Storage.NotFoundError.isInstance(error)) throw error
    await Storage.write(key(candidateId), candidate)
  }
  const requested = requests(events).find((item) => item.payload.approvalId === candidate.approvalId)
  if (requested) {
    if (JSON.stringify(requested.payload.projectFactSubject) !== JSON.stringify(subject))
      throw new Error("project_fact_request_conflict")
    return candidate
  }
  await appendRunEventAtTail(input.runId, { type: "approval_requested", commandId: `request_${candidateId}`, payload: {
    approvalId: candidate.approvalId, approvalType: "workflow_gate", risk: "high", source: "manual",
    title: "Review durable project fact", reason: "Inspect the exact project candidate before deciding.",
    projectFactSubject: subject,
  } })
  return candidate
}

/** Serializes candidate publication and its request; conflicting retries never overwrite. */
export async function proposeProjectFact(input: { runId: string; candidateId: string; change: unknown }) {
  CandidateId.parse(input.candidateId)
  const lock = await acquireProjectLock(Instance.project.id)
  try { return await proposeProjectFactUnderLock(input) }
  finally { await lock.dispose() }
}

async function committedFact(candidate: z.infer<typeof CandidateSchema>, resolutionId?: string) {
  const existing = (await readProjectEvents()).find((event) => event.commandId === candidate.commandId)
  if (!existing) return undefined
  if (existing.type === "project_initialized") throw new Error("project_fact_candidate_conflict")
  const subject = await projectFactApprovalSubject({ projectId: candidate.projectId,
    commandId: candidate.commandId, change: { type: existing.type, payload: existing.payload } as typeof candidate.change })
  if (subject.digest !== candidate.subject.digest || !existing.sourceRefs?.some((ref) =>
    ref.scopeType === "run" && ref.scopeId === candidate.runId && (!resolutionId || ref.eventId === resolutionId)))
    throw new Error("project_fact_candidate_conflict")
  return existing
}

/** A matching durable operator decision is the only authority to promote. */
export async function applyReviewedProjectFact(candidateId: string) {
  const candidate = await readProjectFactCandidate(candidateId)
  const existing = await committedFact(candidate)
  if (existing) return existing // Durable project authority survives source-run retention.
  const events = await readRunEvents(candidate.runId)
  reduceRunState(events)
  const requested = requests(events).find((item) => item.payload.approvalId === candidate.approvalId)
  const resolved = resolutions(events).find((item) => item.payload.approvalId === candidate.approvalId)
  const confirmation = `project-fact-review:${candidate.subject.digest}`
  if (!requested || !resolved ||
    JSON.stringify(requested.payload.projectFactSubject) !== JSON.stringify(candidate.subject) ||
    resolved.payload.decision !== "approved" || !resolved.payload.actor?.trim() ||
    resolved.payload.comment !== confirmation) throw new Error("project_fact_review_required")
  try {
    return await appendProjectEvent({ ...candidate.change, commandId: candidate.commandId,
      sourceRefs: [{ scopeType: "run", scopeId: candidate.runId, eventId: resolved.event.eventId }] })
  } catch (error) {
    // Concurrent or uncertain publication is successful only if this exact
    // approved change is now committed; do not swallow an unrelated failure.
    const committed = await committedFact(candidate, resolved.event.eventId)
    if (committed) return committed
    throw error
  }
}

export async function reviewProjectFact(input: {
  candidateId: string; digest: string; actor: string; decision: "approved" | "rejected"
}) {
  const candidate = await readProjectFactCandidate(input.candidateId)
  if (!input.actor.trim() || input.digest !== candidate.subject.digest)
    throw new Error("project_fact_review_mismatch")
  const events = await readRunEvents(candidate.runId)
  reduceRunState(events)
  const requested = requests(events).find((item) => item.payload.approvalId === candidate.approvalId)
  if (!requested || JSON.stringify(requested.payload.projectFactSubject) !== JSON.stringify(candidate.subject))
    throw new Error("project_fact_request_conflict")
  const resolved = resolutions(events).find((item) => item.payload.approvalId === candidate.approvalId)
  const comment = `project-fact-review:${candidate.subject.digest}`
  if (resolved) {
    if (resolved.payload.decision !== input.decision || resolved.payload.comment !== comment || !resolved.payload.actor?.trim())
      throw new Error("project_fact_decision_conflict")
  } else {
    await appendRunEventAtTail(candidate.runId, { type: "approval_resolved", commandId: `resolve_${candidate.candidateId}`, payload: {
      approvalId: candidate.approvalId, decision: input.decision, actor: input.actor.trim(),
      comment, resolvedAt: new Date().toISOString(),
    } })
  }
  return input.decision === "approved" ? await applyReviewedProjectFact(input.candidateId) : { rejected: true }
}
