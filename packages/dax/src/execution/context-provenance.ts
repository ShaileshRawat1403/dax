import type { AssistantProvenanceContext } from "./assistant-provenance"
import type { ProviderInputPartition } from "./provider-input-partition"
import { DuplicateCommandError, projectRunStateFromEvents } from "@/state/events/run-event-store"
import { recordContextContribution, startContextRecording } from "@/state/events/event-transitions"

export const CONTEXT_PRODUCER_SCOPE = "session_processor_context_v1" as const

export class ContextProvenancePersistenceError extends Error {
  readonly code = "context_provenance_persistence_failed"

  constructor(
    public readonly stage: "marker" | "dispatch" | "settlement",
    public readonly messageId: string,
    cause: unknown,
  ) {
    super(`Failed to durably record context provenance at ${stage} for ${messageId}`, { cause })
    this.name = "ContextProvenancePersistenceError"
  }
}

export function findContextProvenancePersistenceError(error: unknown): ContextProvenancePersistenceError | null {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current instanceof ContextProvenancePersistenceError) return current
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "context_provenance_persistence_failed"
    ) {
      return current as ContextProvenancePersistenceError
    }
    if (typeof current !== "object" || current === null) return null
    current =
      "cause" in current && current.cause
        ? current.cause
        : "error" in current && current.error
          ? current.error
          : "lastError" in current && current.lastError
            ? current.lastError
            : null
  }
  return null
}

async function ensureContextMarker(context: AssistantProvenanceContext): Promise<void> {
  const existing = await projectRunStateFromEvents(context.runId)
  const current = existing?.contextHistory.sessions.find(
    (session) => session.sessionId === context.sessionId && session.markerEventId,
  )
  if (current) {
    if (current.cutoverMessageId !== context.messageId) {
      const message = existing?.assistantHistory.messages.find((candidate) => candidate.messageId === context.messageId)
      if (!message || current.markerSeq === null || message.openedSeq <= current.markerSeq) {
        throw new Error(`Context message ${context.messageId} predates session cutover`)
      }
    }
    return
  }

  const assistantSession = existing?.assistantHistory.sessions.find(
    (session) => session.sessionId === context.sessionId,
  )
  const currentMessage = existing?.assistantHistory.messages.find((message) => message.messageId === context.messageId)
  if (!currentMessage) throw new Error(`Assistant message ${context.messageId} is not durably open`)
  const knownPrior =
    existing?.assistantHistory.messages.some(
      (message) => message.sessionId === context.sessionId && message.openedSeq < currentMessage.openedSeq,
    ) ?? false
  const priorScopeHistory = knownPrior || assistantSession?.priorScopeHistory === "unavailable" ? "unavailable" : "none"
  const copiedHistory = assistantSession?.copiedHistory === "excluded" ? "excluded" : "none"
  try {
    await startContextRecording(context.runId, context.openedEventId, {
      sessionId: context.sessionId,
      priorScopeHistory,
      copiedHistory,
      ...(copiedHistory === "excluded" && assistantSession?.sourceSessionId
        ? { sourceSessionId: assistantSession.sourceSessionId }
        : {}),
      cutoverMessageId: context.messageId,
    })
  } catch (error) {
    if (error instanceof DuplicateCommandError) {
      const state = await projectRunStateFromEvents(context.runId)
      const marker = state?.contextHistory.sessions.find(
        (session) => session.sessionId === context.sessionId && session.markerEventId,
      )
      if (marker?.cutoverMessageId === context.messageId) return
    }
    throw error
  }
}

export type ContextDispatchSettlement = { count: number; finalEventId: string | null }

export function createContextProvenanceTracker(context: AssistantProvenanceContext | null) {
  let count = 0
  let finalEventId: string | null = null

  return {
    messageId: context?.messageId ?? null,
    async record(input: {
      providerId: string
      modelId: string
      promptEventId: string
      dispatchOrdinal: number
      partition: ProviderInputPartition
    }): Promise<void> {
      if (!context) return
      try {
        await ensureContextMarker(context)
      } catch (error) {
        throw new ContextProvenancePersistenceError("marker", context.messageId, error)
      }
      if (input.dispatchOrdinal !== count + 1) {
        throw new ContextProvenancePersistenceError(
          "dispatch",
          context.messageId,
          new Error(`Context dispatch ordinal is not contiguous: ${input.dispatchOrdinal}`),
        )
      }
      try {
        const state = await recordContextContribution(context.runId, input.promptEventId, {
          scope: CONTEXT_PRODUCER_SCOPE,
          sessionId: context.sessionId,
          messageId: context.messageId,
          providerId: input.providerId,
          modelId: input.modelId,
          dispatchOrdinal: input.dispatchOrdinal,
          promptEventId: input.promptEventId,
          partition: input.partition,
        })
        const record = state.contextHistory.dispatches.find(
          (candidate) =>
            candidate.messageId === context.messageId && candidate.dispatchOrdinal === input.dispatchOrdinal,
        )
        if (!record) throw new Error("context contribution did not project")
        count = input.dispatchOrdinal
        finalEventId = record.eventId
      } catch (error) {
        throw new ContextProvenancePersistenceError("dispatch", context.messageId, error)
      }
    },
    settlement(): ContextDispatchSettlement {
      return { count, finalEventId }
    },
    async enrolled(): Promise<boolean> {
      if (!context) return false
      try {
        const state = await projectRunStateFromEvents(context.runId)
        const marker = state?.contextHistory.sessions.find(
          (session) => session.sessionId === context.sessionId && session.markerEventId,
        )
        const message = state?.assistantHistory.messages.find((candidate) => candidate.messageId === context.messageId)
        if (!marker || !message) return false
        return (
          marker.cutoverMessageId === context.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)
        )
      } catch (error) {
        throw new ContextProvenancePersistenceError("settlement", context.messageId, error)
      }
    },
  }
}

export type ContextProvenanceTracker = ReturnType<typeof createContextProvenanceTracker>
