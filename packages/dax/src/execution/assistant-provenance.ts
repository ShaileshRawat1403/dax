import { createHash } from "node:crypto"
import z from "zod"
import { Session } from "@/session"
import type { MessageV2 } from "@/session/message-v2"
import { resolveExecutionAuthority } from "./contract-guardian"
import { getRunAuthority, projectRunStateFromEvents, DuplicateCommandError } from "@/state/events/run-event-store"
import {
  recordAssistantMessageOpened,
  recordAssistantMessageSettled,
  startAssistantRecording,
} from "@/state/events/event-transitions"
import type { AssistantMessageRecord } from "@/state/events/run-reducer"
import type { AssistantErrorCode } from "@/state/events/run-event-types"
import type { PromptDispatchSettlement } from "./prompt-provenance"
import type { ContextDispatchSettlement } from "./context-provenance"

export const ASSISTANT_PRODUCER_SCOPE = "session_processor_v1" as const
export const ASSISTANT_CANONICALIZATION = "assistant-visible-parts-v1" as const

export type AssistantDelegationReceipt = Extract<AssistantMessageRecord["source"], { kind: "task_delegated" }>
export const AssistantDelegationReceiptSchema = z
  .object({
    kind: z.literal("task_delegated"),
    invocationId: z.string().min(1),
    delegationEventId: z.string().min(1),
    authorizationEventId: z.string().min(1),
    parentSessionId: z.string().min(1),
    agent: z.string().min(1),
    mode: z.enum(["created", "resumed"]),
  })
  .strict()

export type CapturedAssistantTextPart = {
  partId: string
  ordinal: number
  attempt: number
  finalization: "finalized_post_plugin" | "interrupted_before_text_end" | "text_end_unfinalized"
  text: string
}

export type AssistantUsage = {
  basis: "reported_finish_steps_only"
  finishStepCount: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export type AssistantSettlement = {
  status: "completed" | "failed" | "cancelled"
  finishReason?: string
  errorCode?: AssistantErrorCode
  attemptCount: number
  usage: AssistantUsage
  textParts: CapturedAssistantTextPart[]
  reasoningPartCount: number
  reasoningUtf8Bytes: number
  promptDispatch?: PromptDispatchSettlement
  contextDispatch?: ContextDispatchSettlement
}

export type AssistantProvenanceContext = {
  canonical: true
  runId: string
  sessionId: string
  messageId: string
  openedEventId: string
}

export class AssistantProvenancePersistenceError extends Error {
  readonly code = "assistant_provenance_persistence_failed"

  constructor(
    public readonly stage: "marker" | "open" | "settle",
    public readonly messageId: string,
    cause: unknown,
  ) {
    super(`Failed to durably record assistant provenance at ${stage} for ${messageId}`, { cause })
    this.name = "AssistantProvenancePersistenceError"
  }
}

export class AssistantProvenanceRecoveryRequiredError extends Error {
  readonly code = "assistant_provenance_recovery_required"

  constructor(
    public readonly runId: string,
    public readonly sessionId: string,
    public readonly unsettledMessageIds: string[],
  ) {
    super(`Assistant provenance recovery is required for session ${sessionId}`)
    this.name = "AssistantProvenanceRecoveryRequiredError"
  }
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
}

export function commitAssistantTextParts(parts: CapturedAssistantTextPart[]) {
  const committedParts = parts.map((part) => ({
    partId: part.partId,
    ordinal: part.ordinal,
    attempt: part.attempt,
    finalization: part.finalization,
    utf8Bytes: Buffer.byteLength(part.text, "utf8"),
    digest: digest(part.text),
  }))
  const canonical = JSON.stringify({
    canonicalization: ASSISTANT_CANONICALIZATION,
    parts: parts.map((part) => ({
      partId: part.partId,
      ordinal: part.ordinal,
      attempt: part.attempt,
      finalization: part.finalization,
      text: part.text,
    })),
  })
  return {
    canonicalization: ASSISTANT_CANONICALIZATION,
    digest: digest(canonical),
    partCount: committedParts.length,
    finalizedPartCount: committedParts.filter((part) => part.finalization === "finalized_post_plugin").length,
    interruptedPartCount: committedParts.filter((part) => part.finalization !== "finalized_post_plugin").length,
    utf8Bytes: committedParts.reduce((total, part) => total + part.utf8Bytes, 0),
    parts: committedParts,
  }
}

export function verifiedAssistantTextParts(
  record: NonNullable<AssistantMessageRecord["settlement"]>["text"],
  parts: MessageV2.Part[],
): MessageV2.TextPart[] | null {
  const eligible = parts.filter(
    (part): part is MessageV2.TextPart => part.type === "text" && part.synthetic !== true && part.ignored !== true,
  )
  if (eligible.length !== record.parts.length) return null
  if (new Set(record.parts.map((part) => part.partId)).size !== record.parts.length) return null

  const textById = new Map(eligible.map((part) => [part.id, part]))
  if (record.parts.some((part) => !textById.has(part.partId))) return null

  const captured: CapturedAssistantTextPart[] = []
  for (const committed of record.parts) {
    const part = textById.get(committed.partId)
    if (!part) return null
    captured.push({
      partId: committed.partId,
      ordinal: committed.ordinal,
      attempt: committed.attempt,
      finalization: committed.finalization,
      text: part.text,
    })
  }
  if (JSON.stringify(commitAssistantTextParts(captured)) !== JSON.stringify(record)) return null

  return record.parts.flatMap((committed) => {
    if (committed.finalization !== "finalized_post_plugin") return []
    const part = textById.get(committed.partId)
    return part ? [part] : []
  })
}

export function verifyAssistantTextCommitment(
  record: NonNullable<AssistantMessageRecord["settlement"]>["text"],
  parts: MessageV2.Part[],
): boolean {
  return verifiedAssistantTextParts(record, parts) !== null
}

export async function requireAssistantProvenanceRecoveryBeforeDispatch(sessionId: string): Promise<void> {
  const session = await Session.get(sessionId)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const runId = authority.governingRunId
  if (!runId || !authority.contract) return
  if ((await getRunAuthority(runId)) !== "event-log") return

  const state = await projectRunStateFromEvents(runId)
  const unsettledMessageIds =
    state?.assistantHistory.messages
      .filter((message) => message.sessionId === sessionId && message.settlement === null)
      .map((message) => message.messageId) ?? []
  if (unsettledMessageIds.length > 0) {
    throw new AssistantProvenanceRecoveryRequiredError(runId, sessionId, unsettledMessageIds)
  }
}

async function ensureRecordingMarker(input: {
  runId: string
  sessionId: string
  currentMessageId?: string
  copiedFromSessionId?: string
}): Promise<string> {
  const existing = await projectRunStateFromEvents(input.runId)
  const existingMarker = existing?.assistantHistory.sessions.find(
    (session) => session.sessionId === input.sessionId && session.markerEventId,
  )
  if (existingMarker?.markerEventId) return existingMarker.markerEventId

  const priorScopeHistory = input.copiedFromSessionId
    ? "none"
    : (await Session.messages({ sessionID: input.sessionId })).some(
          (message) => message.info.role === "assistant" && message.info.id !== input.currentMessageId,
        )
      ? "unavailable"
      : "none"
  try {
    const state = await startAssistantRecording(input.runId, {
      sessionId: input.sessionId,
      priorScopeHistory,
      copiedHistory: input.copiedFromSessionId ? "excluded" : "none",
      ...(input.copiedFromSessionId ? { sourceSessionId: input.copiedFromSessionId } : {}),
      ...(input.currentMessageId ? { cutoverMessageId: input.currentMessageId } : {}),
    })
    const marker = state.assistantHistory.sessions.find((session) => session.sessionId === input.sessionId)
    if (!marker?.markerEventId) throw new Error("assistant coverage marker did not project")
    return marker.markerEventId
  } catch (error) {
    // Two legitimate first messages may race to establish the one session marker.
    // The command still rejects duplicates; only an exact marker already visible
    // in durable state is accepted as successful coordination.
    if (error instanceof DuplicateCommandError) {
      const state = await projectRunStateFromEvents(input.runId)
      const marker = state?.assistantHistory.sessions.find((session) => session.sessionId === input.sessionId)
      if (marker?.markerEventId) return marker.markerEventId
    }
    throw error
  }
}

export async function markDerivedAssistantSession(input: {
  sessionId: string
  copiedFromSessionId: string
}): Promise<void> {
  const session = await Session.get(input.sessionId)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const runId = authority.governingRunId
  if (!runId || !authority.contract) return
  if ((await getRunAuthority(runId)) !== "event-log") return
  try {
    await ensureRecordingMarker({
      runId,
      sessionId: input.sessionId,
      copiedFromSessionId: input.copiedFromSessionId,
    })
  } catch (error) {
    throw new AssistantProvenancePersistenceError("marker", input.sessionId, error)
  }
}

export async function openAssistantMessageProvenance(input: {
  assistantMessage: MessageV2.Assistant
  delegation?: AssistantDelegationReceipt
}): Promise<AssistantProvenanceContext | null> {
  const session = await Session.get(input.assistantMessage.sessionID)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const runId = authority.governingRunId
  if (!runId || !authority.contract) return null
  if ((await getRunAuthority(runId)) !== "event-log") {
    if (session.governingRunId) {
      throw new AssistantProvenancePersistenceError(
        "open",
        input.assistantMessage.id,
        new Error("governed session has no canonical event authority"),
      )
    }
    return null
  }

  let markerEventId: string
  try {
    markerEventId = await ensureRecordingMarker({
      runId,
      sessionId: session.id,
      currentMessageId: input.assistantMessage.id,
    })
  } catch (error) {
    throw new AssistantProvenancePersistenceError("marker", input.assistantMessage.id, error)
  }

  const source: AssistantMessageRecord["source"] = input.delegation
    ? input.delegation
    : session.id === runId
      ? { kind: "root" }
      : {
          kind: "derived",
          ...(session.derivedFromSessionId ? { parentSessionId: session.derivedFromSessionId } : {}),
        }
  const causationId = source.kind === "task_delegated" ? source.delegationEventId : markerEventId
  try {
    const state = await recordAssistantMessageOpened(runId, causationId, {
      phase: "opened",
      scope: ASSISTANT_PRODUCER_SCOPE,
      messageId: input.assistantMessage.id,
      sessionId: session.id,
      parentMessageId: input.assistantMessage.parentID,
      providerId: input.assistantMessage.providerID,
      modelId: input.assistantMessage.modelID,
      agent: input.assistantMessage.agent,
      summary: input.assistantMessage.summary === true,
      source,
    })
    const opened = state.assistantHistory.messages.find((message) => message.messageId === input.assistantMessage.id)
    if (!opened) throw new Error("assistant open event did not project")
    return {
      canonical: true,
      runId,
      sessionId: session.id,
      messageId: input.assistantMessage.id,
      openedEventId: opened.openedEventId,
    }
  } catch (error) {
    throw new AssistantProvenancePersistenceError("open", input.assistantMessage.id, error)
  }
}

export async function settleAssistantMessageProvenance(
  context: AssistantProvenanceContext | null,
  settlement: AssistantSettlement,
): Promise<void> {
  if (!context) return
  try {
    await recordAssistantMessageSettled(context.runId, context.openedEventId, {
      phase: "settled",
      scope: ASSISTANT_PRODUCER_SCOPE,
      messageId: context.messageId,
      sessionId: context.sessionId,
      status: settlement.status,
      ...(settlement.finishReason ? { finishReason: settlement.finishReason } : {}),
      ...(settlement.errorCode ? { errorCode: settlement.errorCode } : {}),
      attemptCount: settlement.attemptCount,
      usage: settlement.usage,
      text: commitAssistantTextParts(settlement.textParts),
      reasoningPartCount: settlement.reasoningPartCount,
      reasoningUtf8Bytes: settlement.reasoningUtf8Bytes,
      ...(settlement.promptDispatch ? { promptDispatch: settlement.promptDispatch } : {}),
      ...(settlement.contextDispatch ? { contextDispatch: settlement.contextDispatch } : {}),
    })
  } catch (error) {
    throw new AssistantProvenancePersistenceError("settle", context.messageId, error)
  }
}
