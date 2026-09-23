import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { resolveExecutionAuthority } from "./contract-guardian"
import { requireAssistantProvenanceRecoveryBeforeDispatch, verifiedAssistantTextParts } from "./assistant-provenance"
import { getRunAuthority, projectRunStateFromEvents, DuplicateCommandError } from "@/state/events/run-event-store"
import {
  startCompactionRecording,
  bindCompactionAttempt as appendCompactionAttempt,
  closeCompactionAttempt,
  recordCompactionReplacement,
} from "@/state/events/event-transitions"
import { commitCompactionPrefix } from "./compaction-prefix"
import type { AssistantMessageRecord, CompactionAttempt } from "@/state/events/run-reducer"

const SCOPE = "session_compaction_replacement_v1" as const

function hasUsableFinalizedText(
  commitment: NonNullable<AssistantMessageRecord["settlement"]>["text"],
  verified: MessageV2.TextPart[],
): boolean {
  const finalized = new Set(commitment.parts
    .filter((part) => part.finalization === "finalized_post_plugin")
    .map((part) => part.partId))
  return verified.some((part) => finalized.has(part.id) && part.text.trim().length > 0)
}

export class CompactionProvenancePersistenceError extends Error {
  readonly code = "compaction_provenance_persistence_failed"
  constructor(public readonly stage: "marker" | "attempt" | "outcome", public readonly summaryMessageId: string, cause: unknown) {
    super(`Failed to durably record compaction provenance at ${stage} for ${summaryMessageId}`, { cause })
    this.name = "CompactionProvenancePersistenceError"
  }
}

export class CompactionRecoveryRequiredError extends Error {
  readonly code = "compaction_provenance_recovery_required"
  constructor(public readonly sessionId: string, public readonly reason: "open_attempt" | "summary_content_mismatch" | "boundary_mismatch") {
    super(`Compaction provenance recovery is required for session ${sessionId}`)
    this.name = "CompactionRecoveryRequiredError"
  }
}

async function canonicalRun(sessionId: string): Promise<string | null> {
  const session = await Session.get(sessionId)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const runId = authority.governingRunId
  if (!runId || !authority.contract) return null
  if ((await getRunAuthority(runId)) === "event-log") return runId
  if (session.governingRunId) throw new Error(`Governed session ${sessionId} has no canonical event authority`)
  return null
}

function streamOf(messages: MessageV2.WithParts[]): AsyncIterable<MessageV2.WithParts> {
  return (async function* () {
    for (const message of messages) yield message
  })()
}

/** The sole history selection boundary for canonical and historical sessions. */
export async function resolveCompactedMessages(sessionId: string): Promise<MessageV2.WithParts[]> {
  return resolveCompactedMessagesInternal(sessionId, false)
}

async function resolveCompactedMessagesInternal(sessionId: string, allowJustCreatedMarker: boolean): Promise<MessageV2.WithParts[]> {
  const runId = await canonicalRun(sessionId)
  if (runId) await requireAssistantProvenanceRecoveryBeforeDispatch(sessionId)
  const newestFirst = await Array.fromAsync(MessageV2.stream(sessionId))
  if (!runId) return MessageV2.filterCompacted(streamOf(newestFirst))
  const state = await projectRunStateFromEvents(runId)
  if (!state) throw new CompactionRecoveryRequiredError(sessionId, "boundary_mismatch")
  const marker = state.compactionHistory.sessions.find((candidate) => candidate.sessionId === sessionId && candidate.markerEventId)
  if (!marker) {
    // Explicit compatibility for a canonical session that predates this producer.
    return MessageV2.filterCompacted(streamOf(newestFirst))
  }
  if (!allowJustCreatedMarker && !state.compactionHistory.attempts.some((attempt) => attempt.sessionId === sessionId)) {
    // A marker without its first attempt may be a crash or uncertain append.
    // Only the in-flight producer that just wrote this marker may continue.
    throw new CompactionRecoveryRequiredError(sessionId, "open_attempt")
  }
  if (state.compactionHistory.attempts.some((attempt) => attempt.sessionId === sessionId && attempt.status === "open")) {
    throw new CompactionRecoveryRequiredError(sessionId, "open_attempt")
  }

  const chronological = newestFirst.reverse()
  const firstMarkerIndex = chronological.findIndex((message) => message.info.id === marker.cutoverMarkerId)
  if (firstMarkerIndex < 0) throw new CompactionRecoveryRequiredError(sessionId, "boundary_mismatch")
  const historical = chronological.slice(0, firstMarkerIndex)
  const historicalActive = marker.priorScopeHistory === "unavailable" || marker.copiedHistory === "excluded"
    ? await MessageV2.filterCompacted(streamOf([...historical].reverse()))
    : historical
  let active = [...historicalActive, ...chronological.slice(firstMarkerIndex)]
  for (const attempt of state.compactionHistory.attempts.filter((candidate) => candidate.sessionId === sessionId && candidate.status === "adopted")) {
    const summary = state.assistantHistory.messages.find((candidate) => candidate.messageId === attempt.summaryMessageId)
    if (!summary?.settlement || summary.settlement.status !== "completed" || summary.settlement.finishReason !== "stop") {
      throw new CompactionRecoveryRequiredError(sessionId, "summary_content_mismatch")
    }
    const stored = chronological.find((message) => message.info.id === attempt.summaryMessageId)
    if (!stored || stored.info.role !== "assistant" || stored.info.error || stored.info.finish !== "stop") {
      throw new CompactionRecoveryRequiredError(sessionId, "summary_content_mismatch")
    }
    const verified = verifiedAssistantTextParts(summary.settlement.text, stored.parts)
    if (!verified || !hasUsableFinalizedText(summary.settlement.text, verified)) {
      throw new CompactionRecoveryRequiredError(sessionId, "summary_content_mismatch")
    }
    const boundary = active.findIndex((message) => message.info.id === attempt.markerMessageId)
    if (boundary < 0 || JSON.stringify(active.slice(0, boundary + 1).map((message) => message.info.id)) !== JSON.stringify(attempt.prefix.messageIds)) {
      throw new CompactionRecoveryRequiredError(sessionId, "boundary_mismatch")
    }
    active = active.slice(boundary)
  }
  return active
}

export type BoundCompaction = { runId: string; attempt: CompactionAttempt; messages: MessageV2.WithParts[] }

/** Captures the exact active input once; provider retries reuse these messages. */
export async function beginCompactionAttempt(input: { sessionId: string; markerMessageId: string; summaryMessageId: string }): Promise<BoundCompaction | null> {
  const runId = await canonicalRun(input.sessionId)
  if (!runId) return null
  const state = await projectRunStateFromEvents(runId)
  let marker = state?.compactionHistory.sessions.find((candidate) => candidate.sessionId === input.sessionId && candidate.markerEventId)
  let createdMarker = false
  if (!marker) {
    const raw = await Array.fromAsync(MessageV2.stream(input.sessionId))
    const index = raw.findIndex((message) => message.info.id === input.markerMessageId)
    if (index < 0 || raw[index].info.role !== "user") throw new CompactionRecoveryRequiredError(input.sessionId, "boundary_mismatch")
    const session = await Session.get(input.sessionId)
    const copiedHistory = session.derivedFromSessionId ? "excluded" : "none"
    const priorScopeHistory = copiedHistory === "excluded" ? "none" : raw.slice(index + 1).some((message) => message.info.role === "assistant" && message.info.summary) ? "unavailable" : "none"
    try {
      const updated = await startCompactionRecording(runId, {
        scope: SCOPE,
        sessionId: input.sessionId,
        cutoverMarkerId: input.markerMessageId,
        priorScopeHistory,
        copiedHistory,
        ...(session.derivedFromSessionId ? { sourceSessionId: session.derivedFromSessionId } : {}),
      })
      marker = updated.compactionHistory.sessions.find((candidate) => candidate.sessionId === input.sessionId)
      createdMarker = true
    } catch (error) {
      if (error instanceof DuplicateCommandError) {
        marker = (await projectRunStateFromEvents(runId))?.compactionHistory.sessions.find((candidate) => candidate.sessionId === input.sessionId)
      }
      if (!marker?.markerEventId) throw new CompactionProvenancePersistenceError("marker", input.summaryMessageId, error)
    }
  }
  if (!marker?.markerEventId) throw new CompactionRecoveryRequiredError(input.sessionId, "boundary_mismatch")
  const active = await resolveCompactedMessagesInternal(input.sessionId, createdMarker)
  const index = active.findIndex((message) => message.info.id === input.markerMessageId)
  if (index < 0 || active[index].info.role !== "user") throw new CompactionRecoveryRequiredError(input.sessionId, "boundary_mismatch")
  const messages = structuredClone(active.slice(0, index + 1))
  const prefix = commitCompactionPrefix(messages.map((message) => message.info.id))
  try {
    const updated = await appendCompactionAttempt(runId, marker.markerEventId, {
      scope: SCOPE,
      sessionId: input.sessionId,
      markerMessageId: input.markerMessageId,
      summaryMessageId: input.summaryMessageId,
      previousReplacementEventId: marker.replacementEventId,
      prefix,
    })
    const attempt = updated.compactionHistory.attempts.find((candidate) => candidate.summaryMessageId === input.summaryMessageId)
    if (!attempt) throw new Error("bound compaction attempt did not project")
    return { runId, attempt, messages }
  } catch (error) {
    throw new CompactionProvenancePersistenceError("attempt", input.summaryMessageId, error)
  }
}

export async function finishCompactionAttempt(bound: BoundCompaction): Promise<boolean> {
  const state = await projectRunStateFromEvents(bound.runId)
  const summary = state?.assistantHistory.messages.find((candidate) => candidate.messageId === bound.attempt.summaryMessageId)
  const settlement = summary?.settlement
  if (!settlement) throw new CompactionRecoveryRequiredError(bound.attempt.sessionId, "open_attempt")
  const stored = await MessageV2.get({ sessionID: bound.attempt.sessionId, messageID: bound.attempt.summaryMessageId }).catch(() => {
    throw new CompactionRecoveryRequiredError(bound.attempt.sessionId, "summary_content_mismatch")
  })
  const verified = verifiedAssistantTextParts(settlement.text, stored.parts)
  if (!verified) throw new CompactionRecoveryRequiredError(bound.attempt.sessionId, "summary_content_mismatch")
  const reason = settlement.status === "failed" ? "failed" : settlement.status === "cancelled" ? "cancelled" : settlement.finishReason !== "stop" ? "finish_not_stop" : hasUsableFinalizedText(settlement.text, verified) ? null : "empty_summary"
  try {
    if (reason) {
      await closeCompactionAttempt(bound.runId, {
        scope: SCOPE,
        sessionId: bound.attempt.sessionId,
        attemptEventId: bound.attempt.eventId,
        summaryMessageId: bound.attempt.summaryMessageId,
        summarySettlementEventId: settlement.eventId,
        reason,
      })
      return false
    }
    const promptEventId = settlement.promptDispatch?.finalEventId
    const contextEventId = settlement.contextDispatch?.finalEventId
    const context = state?.contextHistory.dispatches.find((candidate) => candidate.eventId === contextEventId)
    if (!promptEventId || !contextEventId || !context) throw new Error("summary has no final provider input commitment")
    await recordCompactionReplacement(bound.runId, {
      scope: SCOPE,
      sessionId: bound.attempt.sessionId,
      attemptEventId: bound.attempt.eventId,
      markerMessageId: bound.attempt.markerMessageId,
      summaryMessageId: bound.attempt.summaryMessageId,
      previousReplacementEventId: bound.attempt.previousReplacementEventId,
      prefixDigest: bound.attempt.prefix.digest,
      summarySettlementEventId: settlement.eventId,
      promptEventId,
      contextEventId,
      contextPartitionDigest: context.partition.digest,
      summaryDigest: settlement.text.digest,
    })
    return true
  } catch (error) {
    throw new CompactionProvenancePersistenceError("outcome", bound.attempt.summaryMessageId, error)
  }
}
