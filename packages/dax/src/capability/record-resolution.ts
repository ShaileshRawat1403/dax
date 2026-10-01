import { ulid } from "ulid"
import { readContract, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { recordCapabilityResolution } from "@/state/events/event-transitions"
import { getRunAuthority } from "@/state/events/run-event-store"
import { Log } from "@/util/log"
import { resolveCapabilityAuthority, type CapabilityResolution, type ResolveAuthorityInput } from "./authority"
import type { ACTION_PATHS } from "./authority-paths"

const log = Log.create({ service: "capability-resolution" })

export type RecordedAction = {
  /** Where the governing authority is read from: a session, or the run itself. */
  governedBy: { sessionID: string } | { runId: string }
  /** A short label for the action; a unique subject ID is minted from it. */
  subject: string
  path: (typeof ACTION_PATHS)[number]
  initiator: CapabilityResolution["initiator"]
  executor: ResolveAuthorityInput["executor"]
  source?: ResolveAuthorityInput["source"]
  target?: ResolveAuthorityInput["target"]
}

/**
 * Record what the shared lookup concludes about one action that is not a
 * native invocation, in the governing run's journal.
 *
 * Record only, and isolated. These paths wrote nothing to the journal for the
 * action before, so this write must not become a new way for them to fail or
 * to be refused: any failure, including an unreadable governing reference, is
 * logged and the action proceeds exactly as it would have. An action with no
 * canonical journal, because it has no governing run or its run predates event
 * authority, is not recorded at all. That is an explicit gap, not an allow.
 *
 * Returns the resolution when one was written, so a caller can attach it to
 * what it already persists; never use the result to decide anything.
 */
export async function recordActionResolution(action: RecordedAction): Promise<CapabilityResolution | undefined> {
  try {
    let runId: string | undefined
    let contract: Awaited<ReturnType<typeof resolveExecutionAuthority>>["contract"]
    if ("sessionID" in action.governedBy) {
      const session = await Session.get(action.governedBy.sessionID)
      const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
      runId = authority.governingRunId
      contract = authority.contract
    } else {
      // A workflow, worker or verification run is its own authority: read its
      // contract directly and require it to name this run.
      runId = action.governedBy.runId
      contract = await readContract(runId)
      if (contract && contract.runId !== runId) return undefined
    }
    if (!runId || !contract) return undefined
    if ((await getRunAuthority(runId)) !== "event-log") return undefined

    const resolution = resolveCapabilityAuthority({
      path: action.path,
      initiator: action.initiator,
      contract,
      authorityRunId: runId,
      executor: action.executor,
      source: action.source,
      target: action.target,
      directory: Instance.directory,
      worktree: Instance.worktree,
    })
    await recordCapabilityResolution(runId, { subjectId: `${action.subject}_${ulid()}`, ...resolution })
    return resolution
  } catch (error) {
    log.warn("capability resolution was not recorded", { path: action.path, error })
    return undefined
  }
}
