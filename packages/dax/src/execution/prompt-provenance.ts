import { createHash } from "node:crypto"
import type { AssistantProvenanceContext } from "./assistant-provenance"
import { DuplicateCommandError, projectRunStateFromEvents } from "@/state/events/run-event-store"
import { recordPromptContribution, startPromptRecording } from "@/state/events/event-transitions"
import type { RunEventPayload } from "@/state/events/run-event-types"
import type { ProviderInputPartition } from "./provider-input-partition"

export const PROMPT_PRODUCER_SCOPE = "session_processor_instructions_v1" as const
export const PROMPT_CANONICALIZATION = "provider-adapter-instructions-v1" as const
export const PROMPT_CANONICALIZATION_V2 = "provider-adapter-instructions-v2" as const

export type PromptInstructionSourceKind =
  | "agent_prompt"
  | "provider_prompt"
  | "environment"
  | "instruction_file"
  | "instruction_url"
  | "user_system"
  | "reflection_policy"
  | "reflection_context"
  | "plan_reminder"
  | "queued_user_reminder"
  | "compaction_prompt"
  | "turn_limit"
  | "provider_instructions"
  | "tool_definition"

export type PromptInstructionChannel = "system" | "message" | "provider_option" | "tool"
export type PromptInstructionRole = "system" | "user" | "assistant" | "tool"

/**
 * Source metadata travels with DAX-generated instructions while their content is
 * still structured. It is deliberately separate from the durable commitment:
 * plugins may remove every supplied source before the provider-adapter boundary.
 */
export type PromptInstructionSource = {
  sourceId: string
  kind: PromptInstructionSourceKind
  reference: string
  channel: PromptInstructionChannel
  role?: PromptInstructionRole
  value: unknown
  /** Ephemeral assembly identity; never persisted in the commitment. */
  locator?: { messageId: string; partId: string }
}

export type PromptEffectiveCandidate = {
  channel: PromptInstructionChannel
  role?: PromptInstructionRole
  value: unknown
  /** Current structured value used only to preserve identity before persistence. */
  identityValue?: unknown
  sourceIds: string[]
  /** Exact adapter-prompt location assigned before the SDK flattens messages. */
  locator?: { messageIndex: number; contentPartIndex?: number }
}

export type ProviderAdapterPromptInput = {
  providerId: string
  modelId: string
  prompt: unknown
  tools: unknown
  providerOptions: unknown
  supplied: PromptInstructionSource[]
  effectiveCandidates: PromptEffectiveCandidate[]
  partition?: Omit<ProviderInputPartition, "atoms">
}

type PromptContributionPayload = Extract<RunEventPayload, { type: "prompt_contribution_recorded" }>["payload"]
export type PromptCommitment = PromptContributionPayload["commitment"]

export class PromptProvenancePersistenceError extends Error {
  readonly code = "prompt_provenance_persistence_failed"

  constructor(
    public readonly stage: "marker" | "dispatch" | "settlement",
    public readonly messageId: string,
    cause: unknown,
  ) {
    super(`Failed to durably record prompt provenance at ${stage} for ${messageId}`, { cause })
    this.name = "PromptProvenancePersistenceError"
  }
}

export function findPromptProvenancePersistenceError(error: unknown): PromptProvenancePersistenceError | null {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current instanceof PromptProvenancePersistenceError) return current
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "prompt_provenance_persistence_failed"
    ) {
      return current as PromptProvenancePersistenceError
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

function sortedJsonV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonV1)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined || typeof item === "function") continue
      sorted[key] = sortedJsonV1(item)
    }
    return sorted
  }
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) return null
  return value
}

function canonical(value: unknown): string {
  return JSON.stringify(sortedJsonV1(value)) ?? "null"
}

function digestCanonical(value: unknown): { canonicalization: "sorted-json-v1"; digest: string; utf8Bytes: number } {
  const text = canonical(value)
  return {
    canonicalization: "sorted-json-v1",
    digest: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
    utf8Bytes: Buffer.byteLength(text, "utf8"),
  }
}

function promptMessages(prompt: unknown): Array<{ role?: PromptInstructionRole; content: unknown }> {
  if (!Array.isArray(prompt)) return []
  return prompt.flatMap((message) => {
    if (!message || typeof message !== "object") return []
    const candidate = message as { role?: unknown; content?: unknown }
    if (!candidate.role || !("content" in candidate)) return []
    const role = ["system", "user", "assistant", "tool"].includes(String(candidate.role))
      ? (candidate.role as PromptInstructionRole)
      : undefined
    return [{ role, content: candidate.content }]
  })
}

function locatedMessageValue(
  messages: Array<{ role?: PromptInstructionRole; content: unknown }>,
  locator: NonNullable<PromptEffectiveCandidate["locator"]>,
): { role?: PromptInstructionRole; value: unknown } | null {
  const message = messages[locator.messageIndex]
  if (!message) return null
  if (locator.contentPartIndex === undefined) return { role: message.role, value: message.content }
  if (!Array.isArray(message.content)) return null
  const part = message.content[locator.contentPartIndex]
  if (!part || typeof part !== "object") return null
  const record = part as { type?: unknown; text?: unknown }
  if (record.type !== "text") return null
  return { role: message.role, value: record.text }
}

function providerInstructions(value: unknown): unknown[] {
  const result: unknown[] = []
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== "object") return
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key === "instructions" && child !== undefined) result.push(child)
      else visit(child)
    }
  }
  visit(value)
  return result
}

function adapterTools(value: unknown): Array<{ name: string | null; value: unknown }> {
  if (Array.isArray(value)) {
    return value.map((tool) => ({
      name:
        tool && typeof tool === "object" && "name" in tool && typeof (tool as { name?: unknown }).name === "string"
          ? ((tool as { name: string }).name ?? null)
          : null,
      value: tool,
    }))
  }
  if (!value || typeof value !== "object") return []
  return Object.entries(value as Record<string, unknown>).map(([name, tool]) => ({ name, value: tool }))
}

export function commitProviderAdapterInstructions(input: ProviderAdapterPromptInput): PromptCommitment {
  const supplied = input.supplied.map((source, ordinal) => ({
    sourceId: source.sourceId,
    kind: source.kind,
    reference: source.reference,
    channel: source.channel,
    ...(source.role ? { role: source.role } : {}),
    ordinal,
    ...digestCanonical(source.value),
  }))
  const sourceById = new Map(input.supplied.map((source) => [source.sourceId, source]))
  const candidates = input.effectiveCandidates.map((candidate) => ({
    ...candidate,
    commitment: digestCanonical(candidate.value),
    matched: false,
  }))
  const effective: PromptCommitment["effective"] = []

  const add = (entry: {
    channel: PromptInstructionChannel
    role?: PromptInstructionRole
    value: unknown
    sourceIds: string[]
  }) => {
    effective.push({
      channel: entry.channel,
      ...(entry.role ? { role: entry.role } : {}),
      ordinal: effective.length,
      ...digestCanonical(entry.value),
      origin: entry.sourceIds.length > 0 ? "supplied" : "transform_output",
      sourceIds: entry.sourceIds,
    })
  }

  const messages = promptMessages(input.prompt)
  for (const candidate of candidates.filter((item) => item.channel === "message")) {
    if (!candidate.locator) throw new Error("Message instruction candidate has no adapter locator")
    const located = locatedMessageValue(messages, candidate.locator)
    if (!located || located.role !== candidate.role) {
      throw new Error("Message instruction identity was destroyed before provider dispatch")
    }
    candidate.matched = true
    const sourceSurvived = digestCanonical(located.value).digest === candidate.commitment.digest
    add({
      channel: "message",
      role: located.role,
      value: located.value,
      sourceIds: sourceSurvived ? candidate.sourceIds : [],
    })
  }

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== "system") continue
    const commitment = digestCanonical(message.content)
    const candidate = candidates.find(
      (item) =>
        !item.matched &&
        item.channel === "system" &&
        item.role === message.role &&
        item.locator?.messageIndex === messageIndex &&
        item.locator.contentPartIndex === undefined &&
        item.commitment.digest === commitment.digest,
    )
    if (candidate) {
      candidate.matched = true
      add({ channel: candidate.channel, role: message.role, value: message.content, sourceIds: candidate.sourceIds })
      continue
    }
    add({ channel: "system", role: "system", value: message.content, sourceIds: [] })
  }

  for (const instruction of providerInstructions(input.providerOptions)) {
    const commitment = digestCanonical(instruction)
    const candidate = candidates.find(
      (item) => !item.matched && item.channel === "provider_option" && item.commitment.digest === commitment.digest,
    )
    if (candidate) {
      candidate.matched = true
      add({ channel: "provider_option", value: instruction, sourceIds: candidate.sourceIds })
    } else {
      add({ channel: "provider_option", value: instruction, sourceIds: [] })
    }
  }

  for (const tool of adapterTools(input.tools)) {
    const source = tool.name
      ? input.supplied.find((candidate) => candidate.kind === "tool_definition" && candidate.reference === tool.name)
      : undefined
    const sourceSurvived = source && digestCanonical(source.value).digest === digestCanonical(tool.value).digest
    add({ channel: "tool", value: tool.value, sourceIds: sourceSurvived ? [source.sourceId] : [] })
  }

  for (const entry of effective) {
    for (const sourceId of entry.sourceIds) {
      if (!sourceById.has(sourceId)) throw new Error(`Unknown prompt source identity: ${sourceId}`)
    }
  }

  const canonicalization = input.partition ? PROMPT_CANONICALIZATION_V2 : PROMPT_CANONICALIZATION
  const body = {
    canonicalization,
    supplied,
    effective,
    ...(input.partition ? { partition: input.partition } : {}),
  }
  const digest = `sha256:${createHash("sha256").update(canonical(body), "utf8").digest("hex")}`
  if (input.partition) {
    return {
      canonicalization: PROMPT_CANONICALIZATION_V2,
      digest,
      suppliedCount: supplied.length,
      effectiveCount: effective.length,
      supplied,
      effective,
      partition: input.partition,
    }
  }
  return {
    canonicalization: PROMPT_CANONICALIZATION,
    digest,
    suppliedCount: supplied.length,
    effectiveCount: effective.length,
    supplied,
    effective,
  }
}

async function ensurePromptMarker(context: AssistantProvenanceContext): Promise<void> {
  const existing = await projectRunStateFromEvents(context.runId)
  const current = existing?.promptHistory.sessions.find(
    (session) => session.sessionId === context.sessionId && session.markerEventId,
  )
  if (current) {
    if (current.cutoverMessageId !== context.messageId) {
      const message = existing?.assistantHistory.messages.find((candidate) => candidate.messageId === context.messageId)
      if (!message || current.markerSeq === null || message.openedSeq <= current.markerSeq) {
        throw new Error(`Prompt message ${context.messageId} predates session cutover`)
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
    await startPromptRecording(context.runId, context.openedEventId, {
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
      const marker = state?.promptHistory.sessions.find(
        (session) => session.sessionId === context.sessionId && session.markerEventId,
      )
      if (marker?.cutoverMessageId === context.messageId) return
    }
    throw error
  }
}

export type PromptDispatchSettlement = { count: number; finalEventId: string | null }

export function createPromptProvenanceTracker(context: AssistantProvenanceContext | null) {
  let count = 0
  let finalEventId: string | null = null

  return {
    messageId: context?.messageId ?? null,
    async record(input: ProviderAdapterPromptInput): Promise<void> {
      if (!context) return
      try {
        await ensurePromptMarker(context)
      } catch (error) {
        throw new PromptProvenancePersistenceError("marker", context.messageId, error)
      }
      const dispatchOrdinal = count + 1
      try {
        const commitment = commitProviderAdapterInstructions(input)
        const state = await recordPromptContribution(context.runId, context.openedEventId, {
          scope: PROMPT_PRODUCER_SCOPE,
          sessionId: context.sessionId,
          messageId: context.messageId,
          providerId: input.providerId,
          modelId: input.modelId,
          dispatchOrdinal,
          commitment,
        })
        const record = state.promptHistory.dispatches.find(
          (candidate) => candidate.messageId === context.messageId && candidate.dispatchOrdinal === dispatchOrdinal,
        )
        if (!record) throw new Error("prompt contribution did not project")
        count = dispatchOrdinal
        finalEventId = record.eventId
      } catch (error) {
        throw new PromptProvenancePersistenceError("dispatch", context.messageId, error)
      }
    },
    settlement(): PromptDispatchSettlement {
      return { count, finalEventId }
    },
    async enrolled(): Promise<boolean> {
      if (!context) return false
      try {
        const state = await projectRunStateFromEvents(context.runId)
        const marker = state?.promptHistory.sessions.find(
          (session) => session.sessionId === context.sessionId && session.markerEventId,
        )
        const message = state?.assistantHistory.messages.find((candidate) => candidate.messageId === context.messageId)
        if (!marker || !message) return false
        return (
          marker.cutoverMessageId === context.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)
        )
      } catch (error) {
        throw new PromptProvenancePersistenceError("settlement", context.messageId, error)
      }
    },
  }
}

export type PromptProvenanceTracker = ReturnType<typeof createPromptProvenanceTracker>
