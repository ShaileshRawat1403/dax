import type { Part, AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import type { ProjectedRun, RunNarrativeItem } from "@/server/run-contract"
import type { MessageV2 } from "@/session/message-v2"

export type StreamItemKind =
  | "phase.marker"
  | "run.event"
  | "alert.inline"
  | "message.user"
  | "message.assistant"
  | "compaction.marker"

export type RunPhase = "understanding" | "planning" | "executing" | "verifying" | "complete"

export interface RenderableStreamItem {
  id: string
  kind: StreamItemKind
  timestamp: number
  phase?: RunPhase
  type?: string
  message?: string
  data?: AssistantMessage | UserMessage | MessageV2.Info | RunNarrativeItem
  parts?: Part[]
  expanded?: boolean
  status?: "pending" | "active" | "completed" | "failed"
  /** Number of narrative steps within this phase (only set on phase.marker items) */
  phaseStepCount?: number
  /** Duration in milliseconds (set on phase.marker and run.event items when computable) */
  durationMs?: number
}

const PHASE_MAP: Record<string, RunPhase> = {
  "run.created": "understanding",
  "run.started": "understanding",
  "intent.created": "understanding",
  "plan.compiled": "planning",
  "step.proposed": "planning",
  "step.started": "executing",
  "step.completed": "executing",
  "step.failed": "executing",
  "run.completed": "complete",
  "run.failed": "complete",
  "approval.requested": "executing",
  "approval.resolved": "executing",
  "artifact.created": "executing",
  "audit.posture_updated": "verifying",
  "intervention.required": "executing",
  "intervention.resolved": "executing",
}

const PHASE_ORDER: RunPhase[] = ["understanding", "planning", "executing", "verifying", "complete"]

function getPhaseFromNarrativeItem(item: RunNarrativeItem): RunPhase {
  return PHASE_MAP[item.type] ?? "executing"
}

function getPhaseLabel(phase: RunPhase): string {
  return {
    understanding: "Understanding",
    planning: "Planning",
    executing: "Executing",
    verifying: "Verifying",
    complete: "Complete",
  }[phase]
}

function deriveStatusFromNarrativeItem(item: RunNarrativeItem): "pending" | "active" | "completed" | "failed" {
  switch (item.type) {
    case "run.created":
    case "run.started":
    case "intent.created":
    case "plan.compiled":
    case "step.proposed":
    case "approval.requested":
    case "intervention.required":
      return "completed"
    case "step.started":
      return "active"
    case "step.completed":
    case "approval.resolved":
    case "intervention.resolved":
    case "run.completed":
      return "completed"
    case "step.failed":
    case "run.failed":
      return "failed"
    case "artifact.created":
      return "completed"
    case "audit.posture_updated":
      return "completed"
    default:
      return "pending"
  }
}

function isAlertItem(item: RunNarrativeItem): boolean {
  return (
    item.type === "intervention.required" ||
    item.type === "approval.requested" ||
    item.type === "approval.resolved" ||
    item.type === "intervention.resolved"
  )
}

function isPhaseMarkerCandidate(item: RunNarrativeItem): boolean {
  return [
    "run.created",
    "run.started",
    "run.completed",
    "run.failed",
    "plan.compiled",
    "step.started",
    "step.completed",
  ].includes(item.type)
}

/** Events that count as meaningful "steps" within a phase for the step counter */
const STEP_COUNT_TYPES = new Set([
  "step.started",
  "step.completed",
  "step.failed",
  "approval.requested",
  "approval.resolved",
  "artifact.created",
])

function isCountableStep(item: RunNarrativeItem): boolean {
  return STEP_COUNT_TYPES.has(item.type)
}

function shouldRenderRunEvent(item: RunNarrativeItem): boolean {
  switch (item.type) {
    // Intent prose — shown as soft text under the understanding divider
    case "intent.created":
      return true
    // Errors always surface regardless of phase
    case "step.failed":
    case "run.failed":
      return true
    default:
      return false
  }
}

export function buildStreamItems(
  projectedRun: ProjectedRun | undefined,
  messages: any[],
  partsByMessageId: Record<string, Part[]>,
): RenderableStreamItem[] {
  const streamItems: RenderableStreamItem[] = []

  if (!projectedRun) {
    return buildLegacyStreamItems(messages, partsByMessageId)
  }

  const narrative = projectedRun.narrative ?? []
  const phasesSeen = new Set<RunPhase>()
  const alertItems: RunNarrativeItem[] = []
  const structuralItems: RunNarrativeItem[] = []

  for (const item of narrative) {
    if (isAlertItem(item)) {
      alertItems.push(item)
    } else if (isPhaseMarkerCandidate(item)) {
      structuralItems.push(item)
    } else {
      structuralItems.push(item)
    }
  }

  // Suppress all phase markers for trivial interactions (greetings, simple Q&A)
  // where no plan is ever compiled and no step is ever started. This prevents
  // UNDERSTANDING, COMPLETE, etc. from cluttering the stream for "hi"-style queries.
  const hasNonTrivialWork = narrative.some(
    (n) => n.type === "plan.compiled" || n.type === "step.started" || n.type === "step.proposed",
  )

  for (const item of structuralItems) {
    const phase = getPhaseFromNarrativeItem(item)

    if (!phasesSeen.has(phase) && isPhaseMarkerCandidate(item)) {
      // For trivial queries, suppress all phase markers — just show the messages
      if (!hasNonTrivialWork) {
        phasesSeen.add(phase)
        continue
      }
      phasesSeen.add(phase)
      streamItems.push({
        id: `phase-${phase}`,
        kind: "phase.marker",
        timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
        phase,
        message: getPhaseLabel(phase),
        type: item.type,
        status:
          phase === "complete"
            ? item.type === "run.failed"
              ? "failed"
              : "completed"
            : phase === "executing"
              ? "active"
              : "completed",
        expanded: true,
      })
    }

    // For trivial queries, suppress run.events too — intent.created is not caught by
    // the isPhaseMarkerCandidate guard above so it would otherwise still emit an
    // IntentBlock orphan above the user message even when the phase marker is suppressed.
    if (!hasNonTrivialWork) continue

    if (shouldRenderRunEvent(item)) {
      streamItems.push({
        id: item.id,
        kind: "run.event",
        timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
        phase,
        type: item.type,
        message: item.message,
        data: item,
        status: deriveStatusFromNarrativeItem(item),
        expanded: true,
      })
    }
  }

  for (const item of alertItems) {
    const phase = getPhaseFromNarrativeItem(item)

    if (!phasesSeen.has(phase)) {
      phasesSeen.add(phase)
      streamItems.push({
        id: `phase-${phase}`,
        kind: "phase.marker",
        timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
        phase,
        message: getPhaseLabel(phase),
        type: item.type,
        status: phase === "complete" ? "completed" : phase === "executing" ? "active" : "completed",
        expanded: true,
      })
    }

    streamItems.push({
      id: item.id,
      kind: "alert.inline",
      timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
      phase,
      type: item.type,
      message: item.message,
      data: item,
      status: item.type === "intervention.required" || item.type === "approval.requested" ? "pending" : "completed",
      expanded: true,
    })
  }

  for (const message of messages) {
    if (message.role === "user") {
      const parts = partsByMessageId[message.id] ?? []
      const hasCompactionPart = parts.some((p: any) => p.type === "compaction")
      const hasTextPart = parts.some((p: any) => p.type === "text" && !p.synthetic)
      if (hasCompactionPart && !hasTextPart) {
        // Internal compaction trigger — surface as a context checkpoint divider
        streamItems.push({
          id: `compaction-${message.id}`,
          kind: "compaction.marker",
          timestamp: message.time.created,
          status: "completed",
        })
        continue
      }
      streamItems.push({
        id: message.id,
        kind: "message.user",
        timestamp: message.time.created,
        data: message,
        parts,
        status: "completed",
      })
    } else if (message.role === "assistant") {
      // Compaction summary assistant messages are internal — skip from main stream
      if (
        (message as any).agent === "compaction" ||
        (message as any).mode === "compaction" ||
        (message as any).summary === true
      ) {
        continue
      }
      streamItems.push({
        id: message.id,
        kind: "message.assistant",
        timestamp: message.time.created,
        data: message,
        parts: partsByMessageId[message.id] ?? [],
        status: message.time.completed ? "completed" : "active",
      })
    }
  }

  streamItems.sort((a, b) => a.timestamp - b.timestamp)

  // Reposition the entire UNDERSTANDING block (phase marker + its run.event children)
  // to just after the last user message before planning begins.
  //
  // Why whole block: intent.created has an even earlier server timestamp than run.created,
  // so it sorts to index 0. Moving only the phase marker leaves run.event items floating
  // above the user message with no rail above them (visible as a detached IntentBlock).
  //
  // Order within the block: phase marker first, then run.event items — so the rail
  // always appears above its expandable children in the For loop.
  if (hasNonTrivialWork) {
    // Collect all understanding-phase items and their current indices
    const understandingIndices: number[] = []
    for (let i = 0; i < streamItems.length; i++) {
      const item = streamItems[i]
      if (item.phase === "understanding" && (item.kind === "phase.marker" || item.kind === "run.event")) {
        understandingIndices.push(i)
      }
    }

    if (understandingIndices.length > 0) {
      // Find the first non-understanding phase marker as the boundary
      const nextPhaseIdx = streamItems.findIndex(
        (item) => item.kind === "phase.marker" && item.phase !== "understanding",
      )
      const boundary = nextPhaseIdx !== -1 ? nextPhaseIdx : streamItems.length

      // Last user message before that boundary is the query that triggered the work
      let insertAfterIdx = -1
      for (let i = 0; i < boundary; i++) {
        if (!understandingIndices.includes(i) && streamItems[i].kind === "message.user") {
          insertAfterIdx = i
        }
      }

      if (insertAfterIdx !== -1) {
        // Extract items in their natural order, but put the phase marker first
        const extracted = understandingIndices.map((i) => streamItems[i])
        const phaseMarker = extracted.find((item) => item.kind === "phase.marker")
        const runEvents = extracted.filter((item) => item.kind === "run.event")
        const block = phaseMarker ? [phaseMarker, ...runEvents] : runEvents

        // Remove all understanding items (reverse order preserves indices during splice)
        for (let i = understandingIndices.length - 1; i >= 0; i--) {
          streamItems.splice(understandingIndices[i]!, 1)
        }

        // Recalculate insert position: how many understanding items were before insertAfterIdx
        const removedBefore = understandingIndices.filter((i) => i <= insertAfterIdx).length
        const targetIdx = insertAfterIdx - removedBefore + 1

        streamItems.splice(targetIdx, 0, ...block)
      }
    }
  }

  const merged = mergeAdjacentAssistantEvidenceItems(streamItems)
  annotatePhaseStats(merged, narrative)
  return merged
}

function buildLegacyStreamItems(
  messages: MessageV2.Info[],
  partsByMessageId: Record<string, Part[]>,
): RenderableStreamItem[] {
  const streamItems: RenderableStreamItem[] = []

  for (const message of messages) {
    if (message.role === "user") {
      const parts = partsByMessageId[message.id] ?? []
      const hasCompactionPart = parts.some((p: any) => p.type === "compaction")
      const hasTextPart = parts.some((p: any) => p.type === "text" && !p.synthetic)
      if (hasCompactionPart && !hasTextPart) {
        streamItems.push({
          id: `compaction-${message.id}`,
          kind: "compaction.marker",
          timestamp: message.time.created,
          status: "completed",
        })
        continue
      }
      streamItems.push({
        id: message.id,
        kind: "message.user",
        timestamp: message.time.created,
        data: message,
        parts,
        status: "completed",
      })
    } else if (message.role === "assistant") {
      if (
        (message as any).agent === "compaction" ||
        (message as any).mode === "compaction" ||
        (message as any).summary === true
      ) {
        continue
      }
      streamItems.push({
        id: message.id,
        kind: "message.assistant",
        timestamp: message.time.created,
        data: message,
        parts: partsByMessageId[message.id] ?? [],
        status: message.time.completed ? "completed" : "active",
      })
    }
  }

  return mergeAdjacentAssistantEvidenceItems(streamItems)
}

function canMergeAssistantItems(
  left: RenderableStreamItem | undefined,
  right: RenderableStreamItem,
): left is RenderableStreamItem & { data: AssistantMessage | MessageV2.Info; parts: Part[] } {
  if (!left || left.kind !== "message.assistant") return false
  if (right.kind !== "message.assistant") return false
  const leftAgent = (left.data as AssistantMessage | MessageV2.Info | undefined)?.agent
  const rightAgent = (right.data as AssistantMessage | MessageV2.Info | undefined)?.agent
  // Merge all consecutive turns from the same named agent into a single stream block.
  // This produces a continuous reasoning → tool-calls → answer flow instead of N separate
  // message bubbles — matching the way the model actually thinks across multiple turns.
  // Anonymous messages (no agent field) are kept separate.
  return !!leftAgent && leftAgent === rightAgent
}

function mergeAdjacentAssistantEvidenceItems(items: RenderableStreamItem[]): RenderableStreamItem[] {
  const merged: RenderableStreamItem[] = []

  for (const item of items) {
    const previous = merged[merged.length - 1]
    if (canMergeAssistantItems(previous, item)) {
      const previousData = previous.data as AssistantMessage
      const itemData = item.data as AssistantMessage
      merged[merged.length - 1] = {
        ...previous,
        id: `${previous.id}__${item.id}`,
        parts: [...(previous.parts ?? []), ...(item.parts ?? [])],
        timestamp: previous.timestamp,
        status: previous.status === "active" || item.status === "active" ? "active" : (item.status ?? previous.status),
        data: {
          ...previousData,
          id: `${previousData.id}__${itemData.id}`,
          time: {
            ...previousData.time,
            created: Math.min(previousData.time.created, itemData.time.created),
            completed:
              previousData.time.completed && itemData.time.completed
                ? Math.max(previousData.time.completed, itemData.time.completed)
                : undefined,
          },
        } satisfies AssistantMessage,
      }
      continue
    }

    merged.push(item)
  }

  return merged
}

export function getCurrentPhase(items: RenderableStreamItem[]): RunPhase {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === "phase.marker" && item.status === "active") {
      return item.phase ?? "executing"
    }
    if (item.kind === "run.event" && item.status === "active") {
      return item.phase ?? "executing"
    }
    if (item.kind === "alert.inline" && item.status === "pending") {
      return item.phase ?? "executing"
    }
  }

  const lastItem = items[items.length - 1]
  if (lastItem?.phase) return lastItem.phase

  return "executing"
}

export function getActivePhases(items: RenderableStreamItem[]): Set<RunPhase> {
  const phases = new Set<RunPhase>()

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item.phase) continue

    if (item.kind === "phase.marker" && item.status === "active") {
      phases.add(item.phase)
      break
    }

    if (item.kind === "run.event" && item.status === "active") {
      phases.add(item.phase)
    }

    if (item.kind === "alert.inline" && item.status === "pending") {
      phases.add(item.phase)
    }
  }

  if (phases.size === 0) {
    phases.add("executing")
  }
  return phases
}

function annotatePhaseStats(items: RenderableStreamItem[], narrative: RunNarrativeItem[]): void {
  // Count steps and compute duration per phase from the raw narrative
  const phaseStats = new Map<RunPhase, { count: number; firstTs: number; lastTs: number }>()

  for (const ni of narrative) {
    const phase = getPhaseFromNarrativeItem(ni)
    const ts = ni.timestamp ? new Date(ni.timestamp).getTime() : 0
    const existing = phaseStats.get(phase)
    if (!existing) {
      phaseStats.set(phase, {
        count: isCountableStep(ni) ? 1 : 0,
        firstTs: ts,
        lastTs: ts,
      })
    } else {
      if (isCountableStep(ni)) existing.count++
      if (ts > 0 && ts < existing.firstTs) existing.firstTs = ts
      if (ts > existing.lastTs) existing.lastTs = ts
    }
  }

  // Annotate phase.marker items with computed stats
  for (const item of items) {
    if (item.kind === "phase.marker" && item.phase) {
      const stats = phaseStats.get(item.phase)
      if (stats) {
        item.phaseStepCount = stats.count
        const dur = stats.lastTs - stats.firstTs
        if (dur >= 1000) item.durationMs = dur
      }
    }
  }

  // Compute duration for run.event items from adjacent narrative timestamps
  for (const item of items) {
    if (item.kind !== "run.event") continue
    const ni = item.data as RunNarrativeItem | undefined
    if (!ni?.timestamp) continue
    const itemTs = new Date(ni.timestamp).getTime()

    // For step.completed/step.failed, find the matching step.started
    if (ni.type === "step.completed" || ni.type === "step.failed") {
      for (let j = narrative.length - 1; j >= 0; j--) {
        if (narrative[j].type === "step.started" && narrative[j].timestamp) {
          const startTs = new Date(narrative[j].timestamp).getTime()
          if (startTs <= itemTs) {
            const dur = itemTs - startTs
            if (dur >= 1000) item.durationMs = dur
            break
          }
        }
      }
    }

    // For run.completed/run.failed, duration from run.started
    if (ni.type === "run.completed" || ni.type === "run.failed") {
      for (const n of narrative) {
        if ((n.type === "run.started" || n.type === "run.created") && n.timestamp) {
          const startTs = new Date(n.timestamp).getTime()
          const dur = itemTs - startTs
          if (dur >= 1000) item.durationMs = dur
          break
        }
      }
    }
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return ""
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`
}

export { PHASE_ORDER, getPhaseLabel }
