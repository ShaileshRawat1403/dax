import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"

/**
 * Stage 3 barrier. A run under grant review has no executable contract, and
 * nothing may treat the absence of one as an ungoverned session: not the
 * guardian, not session birth, not a workflow. Every contract read checks this
 * first, and every session entry point checks it before any effect. It holds
 * whatever the review's state, approved and published included, until stage 4.
 */
export class GrantReviewBarrierError extends Error {
  readonly code = "grant_review_non_executable"
  constructor(readonly runId: string) {
    super(`Run ${runId} is under capability grant review and cannot execute`)
    this.name = "GrantReviewBarrierError"
  }
}

/** Where a run's grant review is stored. Its presence is the barrier. */
export function grantReviewPath(runId: string): string[] {
  return ["grant_review", Instance.project.id, runId]
}

/** Whether the run has a grant review. An unreadable store counts as yes. */
export async function hasGrantReview(runId: string): Promise<boolean> {
  try {
    await assertNoGrantReview(runId)
    return false
  } catch {
    return true
  }
}

/** Throws when the run has a grant review. An unreadable store also throws: it fails closed. */
export async function assertNoGrantReview(runId: string): Promise<void> {
  try {
    await Storage.read<unknown>(grantReviewPath(runId))
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) return
    throw error
  }
  throw new GrantReviewBarrierError(runId)
}
