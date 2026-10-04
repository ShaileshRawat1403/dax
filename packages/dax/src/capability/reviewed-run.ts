import { Session } from "@/session"
import { createGrantReviewedRun, startExecution, writeRunMeta } from "@/execution/run-factory"
import { GrantReview, GrantReviewError } from "./grant-review"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import {
  ReviewedGrantOptIn,
  ReviewedRunError,
  ReviseGrantReviewRequest,
  StartGrantReviewRequest,
} from "./reviewed-run-contract"
import type { CreateRunRequest, CreateRunResponse } from "@/server/run-contract"
import { Storage } from "@/storage/storage"

/** Normalize only reviewed operations. No authority refusal enters legacy fallback. */
export async function reviewedOperation<T>(runId: string | undefined, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ReviewedRunError) throw error
    if (error instanceof GrantReviewError)
      throw new ReviewedRunError(error.code, error.code === "review_missing" ? 404 : 409, runId)
    if (error instanceof GrantReviewBarrierError) throw new ReviewedRunError("authority_not_executable", 409, runId)
    if (error instanceof Storage.NotFoundError) throw new ReviewedRunError("review_missing", 404, runId)
    // Corrupt/unreadable authority is uncertainty, never ordinary absence.
    throw new ReviewedRunError("authority_unreadable", 409, runId)
  }
}

export async function createReviewedRun(input: CreateRunRequest): Promise<CreateRunResponse> {
  const parsed = ReviewedGrantOptIn.safeParse(input.capabilityReview)
  if (!parsed.success) throw new ReviewedRunError("invalid_reviewed_opt_in", 400)
  const { mode: _mode, successorOf, ...inputs } = parsed.data
  return reviewedOperation(undefined, async () => {
    if (successorOf) await Session.get(successorOf) // Provenance existence, no authority copying.
    const { runId } = await createGrantReviewedRun({ request: input }, inputs, { restrictedGeneric: true })
    const review = await GrantReview.inspect(runId)
    await writeRunMeta(runId, {
      sourceSystem: input.metadata?.source ?? "api",
      initiatedBy: input.metadata?.initiatedBy,
      workspaceId: input.metadata?.workspaceId,
      projectId: input.metadata?.projectId,
      chatId: input.metadata?.chatId,
      workflowId: input.metadata?.workflowId,
      targeting: input.metadata?.targeting,
      contractId: review.contractId,
      workflowClass: "generic",
      ...(successorOf ? { successorOf } : {}),
    })
    const session = await Session.get(runId)
    return {
      runId,
      status: "waiting_approval",
      createdAt: new Date(session.time.created).toISOString(),
      workflowHint: "generic",
      workflowHintAccepted: true,
      workflowClass: "generic",
      grantReview: { ...review.expected, location: `/runs/${runId}/grant-review` },
    }
  })
}

export async function inspectReviewedRun(runId: string) {
  return reviewedOperation(runId, () => GrantReview.inspect(runId))
}
export async function reviseReviewedRun(runId: string, input: unknown) {
  const parsed = ReviseGrantReviewRequest.safeParse(input)
  if (!parsed.success) throw new ReviewedRunError("invalid_revision_request", 400, runId)
  return reviewedOperation(runId, async () => {
    await GrantReview.reviseFromInputs(runId, parsed.data.expected, parsed.data.inputs)
    return GrantReview.inspect(runId)
  })
}
export async function startReviewedRun(runId: string, input: unknown) {
  const parsed = StartGrantReviewRequest.safeParse(input)
  if (!parsed.success) throw new ReviewedRunError("invalid_start_request", 400, runId)
  return reviewedOperation(runId, async () => {
    const published = await GrantReview.claimStart(runId, parsed.data.expected)
    // All owner locks have been released. The durable claim is never retried,
    // even if this process dies before prompt dispatch. Existing completion
    // adjudication and canonical failure handling remain in startExecution.
    await startExecution(runId, published.contract)
    return { runId, status: "running" as const, claimed: true as const }
  })
}
