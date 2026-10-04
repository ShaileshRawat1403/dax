import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"

/**
 * Strict review-presence barrier for ordinary v1 writers and identity consumers.
 * Reviewed execution uses the separate read-only image/publication gate.
 * A private record lost after canonical review cannot restore legacy authority.
 */
export class GrantReviewBarrierError extends Error {
  readonly code = "grant_review_non_executable"
  constructor(
    readonly runId: string,
    readonly reasonCode:
      | "activation_missing"
      | "binding_changed"
      | "binding_unavailable"
      | "authority_unreadable" = "activation_missing",
  ) {
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
    if (Storage.NotFoundError.isInstance(error)) {
      // Losing the private record cannot erase canonical review authority.
      // Read-only replay is safe under guardian/event writers: no repair or lock.
      const { hasJournaledGrantReview } = await import("@/state/events/run-event-store")
      if (await hasJournaledGrantReview(runId)) throw new GrantReviewBarrierError(runId)
      return
    }
    throw error
  }
  throw new GrantReviewBarrierError(runId)
}
