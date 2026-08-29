import { Session } from "@/session"
import { Agent } from "@/agent/agent"
import { Permission } from "@/governance"
import { enforceRuntimeGuard, RuntimeGuardViolationError } from "./runtime-guard"
import { getEventAuthorityState } from "@/state/events/event-transitions"
import {
  denyNativeAuthorization,
  noteNativePolicyDecision,
  requireNativeSettlementPending,
  resolveNativeSettlementAuthority,
} from "./native-settlement"

export type GovernedAskRequest = {
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

export type GovernedAskInput = {
  sessionID: string
  agent: string
  toolID?: string
  callID?: string
  messageID?: string
  req: GovernedAskRequest
}

async function resolveRuleset(sessionID: string, agentName: string): Promise<Permission.Ruleset> {
  const [agent, session] = await Promise.all([Agent.get(agentName).catch(() => undefined), Session.get(sessionID)])
  return Permission.merge(agent?.permission ?? [], session.permission ?? [])
}

/**
 * Approvals correlated to this invocation, split by which policy layer
 * created them. RuntimeGuard's own escalation path creates approvals with
 * source "system"; Permission's ask/deny path creates them with source
 * "permission". The schema only requires that some policy component be
 * "approval_required" whenever approvalIds is non-empty, not that the
 * attribution be exact, so this split is a best-effort, truthful attribution
 * rather than a hard architectural guarantee.
 */
async function correlatedApprovedApprovals(
  authorityRunId: string,
  invocationId: string,
): Promise<{ system: string[]; permission: string[] }> {
  const state = await getEventAuthorityState(authorityRunId)
  const approved = (state?.approvals ?? []).filter(
    (approval) => approval.correlationId === invocationId && approval.status === "approved",
  )
  return {
    system: approved.filter((approval) => approval.source === "system").map((approval) => approval.approvalId),
    permission: approved.filter((approval) => approval.source === "permission").map((approval) => approval.approvalId),
  }
}

/**
 * The real policy evaluation a governed tool call runs through: RuntimeGuard,
 * then Permission. Identical behavior to the inline logic this replaces
 * (preserving throw semantics for denial/rejection), with one addition: when
 * `callID` identifies a canonical native invocation, the successful decision
 * is accumulated with every other ask() for that invocation. The tool must
 * then call ctx.authorize(), which appends the one combined effective
 * authorization fact before execution. A denial is appended immediately.
 */
export async function governedAsk(input: GovernedAskInput): Promise<void> {
  const invocationId = input.callID
  const authority = invocationId ? await resolveNativeSettlementAuthority(input.sessionID) : null

  // A canonical policy check without the process-local handoff is a crash or
  // bypass, not an ungoverned request. Refuse before running mutable policy or
  // creating approvals; only beginNativeInvocation may establish the attempt.
  if (invocationId && authority?.canonical) requireNativeSettlementPending(invocationId)

  try {
    await enforceRuntimeGuard({
      sessionID: input.sessionID,
      agent: input.agent,
      toolID: input.toolID,
      req: input.req,
      callID: input.callID,
      invocationId,
    })
  } catch (error) {
    if (invocationId && authority?.canonical) {
      await denyNativeAuthorization(invocationId, {
        finalDisposition: "denied",
        runtimeGuardDisposition: "denied",
        permissionDisposition: "not_evaluated",
        approvalIds: [],
        reasonCodes: [error instanceof RuntimeGuardViolationError ? error.code : "runtime_guard_denied"],
      })
    }
    throw error
  }

  try {
    await Permission.ask({
      ...input.req,
      sessionID: input.sessionID,
      tool: input.callID ? { messageID: input.messageID ?? input.callID, callID: input.callID } : undefined,
      ruleset: await resolveRuleset(input.sessionID, input.agent),
      invocationId,
    })
  } catch (error) {
    if (invocationId && authority?.canonical) {
      const correlated = await correlatedApprovedApprovals(authority.authorityRunId, invocationId)
      await denyNativeAuthorization(invocationId, {
        finalDisposition: "denied",
        runtimeGuardDisposition: correlated.system.length > 0 ? "approval_required" : "allowed",
        permissionDisposition: "denied",
        approvalIds: [...correlated.system, ...correlated.permission],
        reasonCodes: ["permission_denied"],
      })
    }
    throw error
  }

  if (invocationId && authority?.canonical) {
    const correlated = await correlatedApprovedApprovals(authority.authorityRunId, invocationId)
    noteNativePolicyDecision(invocationId, {
      finalDisposition: "allowed",
      runtimeGuardDisposition: correlated.system.length > 0 ? "approval_required" : "allowed",
      permissionDisposition: correlated.permission.length > 0 ? "approval_required" : "allowed",
      approvalIds: [...correlated.system, ...correlated.permission],
      reasonCodes: [],
    })
  }
}
