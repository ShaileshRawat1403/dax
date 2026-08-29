import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { resolveExecutionAuthority } from "./contract-guardian"
import { addArtifactEvent } from "@/state/events/event-transitions"
import { getRunAuthority, projectRunStateFromEvents } from "@/state/events/run-event-store"
import type { CanonicalRunState } from "@/state/events/run-reducer"
import { RunCompletionBlockedError, RunLifecycle } from "@/state/run-lifecycle"

export type NativeCompletionDecision = {
  candidate: boolean
  accepted: boolean
  runId?: string
  reasonCodes: string[]
}

function invocationRejectionReasons(invocations: CanonicalRunState["invocations"]): string[] {
  return Object.values(invocations).flatMap((invocation) => {
    if (invocation.status === "completed") return []
    if (invocation.status === "awaiting_authorization") {
      return [`invocation_awaiting_authorization:${invocation.invocationId}`]
    }
    if (invocation.status === "authorized") {
      return [`invocation_missing_result:${invocation.invocationId}`]
    }
    return [`invocation_unsuccessful:${invocation.status}:${invocation.invocationId}`]
  })
}

function approvalRejectionReasons(approvals: CanonicalRunState["approvals"]): string[] {
  return approvals.flatMap((approval) => {
    if (approval.status === "approved") return []
    if (approval.status === "pending") return [`approval_pending:${approval.approvalId}`]
    return [`approval_not_approved:${approval.status}:${approval.approvalId}`]
  })
}

/**
 * Treats a provider stop as a proposal to complete, never as completion itself.
 * All authority decisions come from the governing contract and canonical event
 * projection. The conversational Session state is deliberately not consulted.
 */
export async function adjudicateNativeCompletionCandidate(input: {
  sessionID: string
  assistantMessageID: string
  finishReason?: string
  hasError?: boolean
}): Promise<NativeCompletionDecision> {
  if (input.finishReason !== "stop") {
    return { candidate: false, accepted: false, reasonCodes: [`finish_reason:${input.finishReason ?? "missing"}`] }
  }

  const session = await Session.get(input.sessionID)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const runId = authority.governingRunId
  if (!runId || !authority.contract) {
    return { candidate: true, accepted: false, reasonCodes: ["ungoverned_session"] }
  }
  const runAuthority = await getRunAuthority(runId)
  if (runAuthority !== "event-log") {
    if (!session.governingRunId) {
      return {
        candidate: true,
        accepted: false,
        runId,
        reasonCodes: [`non_canonical_authority:${runAuthority ?? "missing"}`],
      }
    }
    throw new Error(`Native completion candidate for ${session.id} has no canonical event authority`)
  }

  if (input.hasError) {
    return { candidate: true, accepted: false, runId, reasonCodes: ["provider_or_session_error"] }
  }

  const assistant = await MessageV2.get({ sessionID: session.id, messageID: input.assistantMessageID })
  if (assistant.info.role !== "assistant") {
    throw new Error(`Native completion candidate ${input.assistantMessageID} is not an assistant message`)
  }

  const state = await projectRunStateFromEvents(runId)
  if (!state) throw new Error(`Canonical run ${runId} has no projected state`)
  if (state.status === "completed") {
    return { candidate: true, accepted: true, runId, reasonCodes: [] }
  }
  if (state.status !== "running" && state.status !== "waiting_approval") {
    return { candidate: true, accepted: false, runId, reasonCodes: [`run_not_running:${state.status}`] }
  }

  const authorityReasons = [
    ...invocationRejectionReasons(state.invocations),
    ...approvalRejectionReasons(state.approvals),
  ]
  if (authorityReasons.length > 0) {
    return { candidate: true, accepted: false, runId, reasonCodes: authorityReasons }
  }

  const hasTextOutput = assistant.parts.some(
    (part) => part.type === "text" && part.synthetic !== true && part.text.trim().length > 0,
  )
  const hasMutationOutput =
    state.governance.mutationReceiptIds.length > 0 && state.governance.touchedFiles.length > 0
  const outputTypes = new Set(
    authority.contract.expectedOutputs
      .map((output) => output.type)
      .filter((outputType) => {
        if (outputType === "summary" || outputType === "report") return hasTextOutput
        return hasMutationOutput
      }),
  )

  for (const outputType of outputTypes) {
    await addArtifactEvent(runId, `native_output_${input.assistantMessageID}_${outputType}`, outputType)
  }

  try {
    await RunLifecycle.transition(runId, "completed", "run_completed", {}, { requirePassingCompletionProof: true })
    return { candidate: true, accepted: true, runId, reasonCodes: [] }
  } catch (error) {
    if (error instanceof RunCompletionBlockedError) {
      return {
        candidate: true,
        accepted: false,
        runId,
        reasonCodes: error.failedChecks.map((check) => `completion_proof:${check}`),
      }
    }
    throw error
  }
}
