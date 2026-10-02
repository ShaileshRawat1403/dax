import { Agent } from "@/agent/agent"
import { GrantReviewBarrierError, hasGrantReview } from "@/execution/grant-review-barrier"
import { CapabilityActionDeniedError, recordActionResolution } from "@/capability/record-resolution"
import { resolveExecutionAuthority } from "@/execution/contract-guardian"
import { decideContractTool } from "@/execution/execution-contract"
import { Permission } from "@/governance"
import { NamedError } from "@dax-ai/util/error"
import { resolveCapabilityAuthority } from "@/capability/authority"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { recordCapabilityResolution } from "@/state/events/event-transitions"
import { getRunAuthority } from "@/state/events/run-event-store"
import { Session } from "."

export type OperatorShellAuthorization =
  | { governed: false }
  | { governed: true; disposition: "allowed"; contractId: string; governingRunId: string }

const log = Log.create({ service: "operator-shell-authority" })

/** The operator's shell command was refused by the session's governing authority. */
export class OperatorShellDeniedError extends NamedError.Unknown {
  readonly code = "operator_shell_denied"
  constructor(
    public readonly reasonCode:
      | "contract_tool_denied"
      | "contract_alias_executor_mismatch"
      | "permission_denied"
      | "governing_authority_changed"
      /** An activated reviewed run's enforced decision, by its reason code. */
      | `grant:${string}`,
    public readonly contractId: string | undefined,
  ) {
    const message = `Operator shell denied: ${reasonCode}`
    super({ message })
    this.message = message
  }
}

/**
 * Decide whether the operator's direct shell may run in this session.
 *
 * A session with no governing contract is operator-direct and ungoverned, as it
 * always was. A session that has one is bound by it: a contract that does not
 * allow `shell`, or a permission rule that denies the command, refuses the
 * command before any process is launched. An unreadable governing reference
 * throws rather than being read as ungoverned.
 *
 * Only a denial refuses. A rule that would ask is not a second prompt here:
 * the operator typed the command, and that submission is the approval.
 *
 * Resolving the contract and the agent both await. The session is therefore
 * read again after them, as the last thing awaited, and the decision is made
 * on that snapshot: a denial installed while the authority was being resolved
 * is a denial. The snapshot must still name the governing run that was
 * resolved; if it does not, the contract read above no longer governs this
 * session and the command is refused rather than judged against it.
 */
/**
 * Stage 4c: the operator's shell in an activated reviewed run. The published
 * contract decides, enforced and recorded before the spawn; permission denials
 * still apply on top. A reviewed run that is not activated meets the barrier.
 */
async function authorizeReviewedOperatorShell(
  input: Parameters<typeof authorizeOperatorShell>[0],
  runId: string,
): Promise<OperatorShellAuthorization> {
  const { GrantReview } = await import("@/capability/grant-review")
  const reviewed = await GrantReview.dispatchAuthority(runId)
  if (!reviewed) throw new GrantReviewBarrierError(runId)
  const contractId = reviewed.published.contract.contractId
  try {
    await recordActionResolution({
      governedBy: { runId },
      subject: "operator_shell",
      path: "operator_shell",
      initiator: "operator",
      executor: { kind: "builtin", alias: "shell", descriptor: input.capability },
    })
  } catch (error) {
    if (error instanceof CapabilityActionDeniedError) {
      throw new OperatorShellDeniedError(`grant:${error.reasonCode}`, contractId)
    }
    throw error
  }
  const session = await Session.get(input.sessionID)
  if ((session.governingRunId ?? session.id) !== runId) {
    throw new OperatorShellDeniedError("governing_authority_changed", contractId)
  }
  const agent = await Agent.get(input.agent).catch(() => undefined)
  const rule = Permission.evaluate("shell", input.command, agent?.permission ?? [], session.permission ?? [])
  if (rule.action === "deny") throw new OperatorShellDeniedError("permission_denied", contractId)
  return { governed: true, disposition: "allowed", contractId, governingRunId: runId }
}

export async function authorizeOperatorShell(input: {
  sessionID: string
  agent: string
  command: string
  /** The persisted tool part's call ID: the subject of the shadow record. */
  callID: string
  /** The operator shell's own descriptor, from its identity binding. */
  capability: unknown
}): Promise<OperatorShellAuthorization> {
  const initial = await Session.get(input.sessionID)
  const reviewedRunId = initial.governingRunId ?? initial.id
  if (await hasGrantReview(reviewedRunId)) return authorizeReviewedOperatorShell(input, reviewedRunId)
  const authority = await resolveExecutionAuthority(initial.id, initial.governingRunId)
  const agent = await Agent.get(input.agent).catch(() => undefined)

  // Record what the shared lookup concludes, in the governing run's journal when
  // it has one. This is a shadow of the contract decision only: it is written
  // before the permission snapshot below so that nothing is awaited between
  // that snapshot and the spawn, and it takes no part in the decision.
  //
  // A record-only write must not be able to refuse the operator's command. The
  // shell wrote nothing to the journal before this existed, so a journal that
  // cannot be appended to would otherwise become a new way for the shell to
  // fail. If the write fails it is logged and the decision proceeds unrecorded.
  if (authority.contract && authority.governingRunId) {
    const governingRunId = authority.governingRunId
    const resolution = resolveCapabilityAuthority({
      path: "operator_shell",
      initiator: "operator",
      contract: authority.contract,
      authorityRunId: governingRunId,
      executor: { kind: "builtin", alias: "shell", descriptor: input.capability },
      directory: Instance.directory,
      worktree: Instance.worktree,
    })
    await (async () => {
      if ((await getRunAuthority(governingRunId)) !== "event-log") return
      await recordCapabilityResolution(governingRunId, { subjectId: input.callID, ...resolution })
    })().catch((error) => {
      log.warn("operator shell capability resolution was not recorded", { governingRunId, error })
    })
  }

  // Nothing is awaited between this read and the decision below.
  const session = await Session.get(input.sessionID)
  const contract = authority.contract ?? undefined
  if (session.governingRunId !== initial.governingRunId) {
    throw new OperatorShellDeniedError("governing_authority_changed", contract?.contractId)
  }
  if (!contract || !authority.governingRunId) return { governed: false }

  const decision = decideContractTool(contract, "shell", { kind: "builtin" })
  if (!decision.allowed) throw new OperatorShellDeniedError(decision.reasonCode, contract.contractId)

  const rule = Permission.evaluate("shell", input.command, agent?.permission ?? [], session.permission ?? [])
  if (rule.action === "deny") throw new OperatorShellDeniedError("permission_denied", contract.contractId)

  return {
    governed: true,
    disposition: "allowed",
    contractId: contract.contractId,
    governingRunId: authority.governingRunId,
  }
}
