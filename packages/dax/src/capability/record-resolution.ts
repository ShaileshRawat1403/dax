import { ulid } from "ulid"
import { mcpReadDescriptor, mcpReadDescriptorV2 } from "@/mcp/resource-identity"
import { CapabilityDescriptor } from "./capability-types"
import { readContract, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { assertNoGrantReview, GrantReviewBarrierError } from "@/execution/grant-review-barrier"
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

/** An action an activated reviewed run's published contract does not allow. Nothing ran. */
export class CapabilityActionDeniedError extends Error {
  constructor(
    readonly path: RecordedAction["path"],
    readonly reasonCode: string,
  ) {
    super(`Capability action ${path} was denied: ${reasonCode}`)
    this.name = "CapabilityActionDeniedError"
  }
}

/**
 * Stage 4c: an action in an activated reviewed run is decided, not shadowed.
 * The published contract and the journal's activation decide it before any
 * effect; the enforced resolution is written before the action proceeds, and
 * a write that fails denies it. A reviewed run that is not activated meets the
 * barrier here too, rather than proceeding unrecorded.
 */
async function governReviewed(action: RecordedAction): Promise<"not_reviewed" | CapabilityResolution> {
  // Compatibility is only for a run positively shown to have no review: its
  // governing run was read, and the review store answered that none exists.
  // Anything uncertain, from an unreadable session to an unreadable store or
  // no instance to read it in, denies before the action has any effect.
  let runId: string
  try {
    runId =
      "runId" in action.governedBy
        ? action.governedBy.runId
        : await Session.get(action.governedBy.sessionID).then((session) => session.governingRunId ?? session.id)
  } catch (error) {
    log.warn("governing authority could not be read; the action is denied", { path: action.path, error })
    throw new CapabilityActionDeniedError(action.path, "authority_unreadable")
  }
  try {
    await assertNoGrantReview(runId)
    return "not_reviewed"
  } catch (error) {
    if (!(error instanceof GrantReviewBarrierError)) {
      log.warn("grant review state could not be read; the action is denied", { path: action.path, error })
      throw new CapabilityActionDeniedError(action.path, "authority_unreadable")
    }
  }
  const { GrantReview } = await import("./grant-review")
  const reviewed = await GrantReview.dispatchAuthority(runId)
  if (!reviewed) throw new GrantReviewBarrierError(runId)
  const { captureDispatchSnapshot } = await import("./grant-review-snapshot")
  const { decideReviewedAction, enforcedRecord, settleAsk } = await import("./enforcement")
  // An MCP read is decided, and recorded, under its v2 identity, which commits
  // to the server without recording the item. The v1 identity minted at the
  // read site must first prove to be this exact source; otherwise the read
  // keeps an identity no source grant covers.
  const executor = reviewedReadExecutor(action)
  // Decided from the authority and implementation as they are at the moment
  // of deciding; called again after any wait for the operator.
  const decideNow = async (authority: NonNullable<typeof reviewed> | undefined) => {
    if (!authority) return undefined
    return decideReviewedAction({
      contract: authority.published.contract,
      contractDigest: authority.published.contractDigest,
      activation: authority.activation,
      resolve: {
        path: action.path,
        initiator: action.initiator,
        authorityRunId: runId,
        executor,
        source: action.source,
        target: action.target,
        directory: Instance.directory,
        worktree: Instance.worktree,
      },
      current: await captureDispatchSnapshot(authority.published.contract),
    })
  }
  const decided = (await decideNow(reviewed))!
  // An action has no later authorization: an ask is settled, by memory or by
  // asking the operator now, then checked again, before its resolution is recorded.
  const subjectId = `${action.subject}_${ulid()}`
  const { resolution, expired } = await settleAsk(runId, decided, {
    askNow: subjectId,
    decideNow: async () => decideNow(await GrantReview.dispatchAuthority(runId)),
  })
  try {
    await recordCapabilityResolution(runId, {
      subjectId,
      ...(enforcedRecord(resolution) as Omit<Parameters<typeof recordCapabilityResolution>[1], "subjectId">),
    })
  } catch (error) {
    log.warn("enforced capability resolution was not recorded; the action is denied", { path: action.path, error })
    throw new CapabilityActionDeniedError(action.path, "resolution_unrecorded")
  }
  if (expired) await (await import("./grant-ask")).expireAsk(runId, expired)
  if (resolution.decision === "deny" || (resolution.decision === "ask" && !resolution.askSatisfiedBy)) {
    throw new CapabilityActionDeniedError(action.path, resolution.reasonCode ?? "grant_denied")
  }
  return resolution as unknown as CapabilityResolution
}

function reviewedReadExecutor(action: RecordedAction): RecordedAction["executor"] {
  const family = action.path === "mcp_resource" ? "resource" : action.path === "mcp_prompt" ? "prompt" : undefined
  if (!family || !action.source) return action.executor
  try {
    // The supplied descriptor must be a complete, valid descriptor and exactly
    // this source's v1 descriptor. Anything else is left as given, so the
    // lookup still denies it (descriptor_invalid, or source_unproven); an
    // invalid descriptor is never repaired into a valid identity.
    const parsed = CapabilityDescriptor.safeParse(action.executor.descriptor)
    if (!parsed.success) return action.executor
    const v1 = mcpReadDescriptor(family, action.source.server, action.source.name)
    const given = parsed.data
    if (
      given.id !== v1.id ||
      given.riskClass !== v1.riskClass ||
      given.scopeSupport !== v1.scopeSupport ||
      given.requiresVerification !== v1.requiresVerification
    ) {
      return action.executor
    }
    return { ...action.executor, descriptor: mcpReadDescriptorV2(family, action.source.server, action.source.name) }
  } catch {
    return action.executor
  }
}

/**
 * Record what the shared lookup concludes about one action that is not a
 * native invocation, in the governing run's journal.
 *
 * In an activated reviewed run this decides instead, and throws
 * `CapabilityActionDeniedError` before the action has any effect; see
 * `governReviewed`. Everywhere else:
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
  // Not isolated: a reviewed run's decision and its barrier must reach the caller.
  const governed = await governReviewed(action)
  if (governed !== "not_reviewed") return governed
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
