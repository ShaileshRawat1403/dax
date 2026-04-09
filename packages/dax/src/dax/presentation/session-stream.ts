import type { Part, AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import type { ProjectedRun, RunNarrativeItem } from "@/server/run-contract"
import type { MessageV2 } from "@/session/message-v2"

export type StreamItemKind = "phase.marker" | "run.event" | "alert.inline" | "message.user" | "message.assistant"

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
  return item.type === "intervention.required" || item.type === "approval.requested"
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
  "step.started", "step.completed", "step.failed",
  "approval.requested", "approval.resolved",
  "artifact.created",
])

function isCountableStep(item: RunNarrativeItem): boolean {
  return STEP_COUNT_TYPES.has(item.type)
}

function shouldRenderRunEvent(item: RunNarrativeItem): boolean {
  switch (item.type) {
    case "run.completed":
    case "run.failed":
    case "step.failed":
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

  for (const item of structuralItems) {
    const phase = getPhaseFromNarrativeItem(item)

    if (!phasesSeen.has(phase) && isPhaseMarkerCandidate(item)) {
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
      streamItems.push({
        id: message.id,
        kind: "message.user",
        timestamp: message.time.created,
        data: message,
        parts: partsByMessageId[message.id] ?? [],
        status: "completed",
      })
    } else if (message.role === "assistant") {
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
      streamItems.push({
        id: message.id,
        kind: "message.user",
        timestamp: message.time.created,
        data: message,
        parts: partsByMessageId[message.id] ?? [],
        status: "completed",
      })
    } else if (message.role === "assistant") {
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

function isHelperAssistantItem(item: RenderableStreamItem): item is RenderableStreamItem & {
  kind: "message.assistant"
  data: AssistantMessage | MessageV2.Info
  parts: Part[]
} {
  if (item.kind !== "message.assistant") return false
  if (!item.parts || item.parts.length === 0) return false
  return item.parts.every((part) => {
    if (part.type === "text") return false
    if (part.type === "tool") return true
    if (part.type === "reasoning") return true
    if ((part as { type?: string }).type === "activity-cluster") return true
    if ((part as { type?: string }).type === "context-group") return true
    return false
  })
}

function canMergeAssistantItems(
  left: RenderableStreamItem | undefined,
  right: RenderableStreamItem,
): left is RenderableStreamItem & { data: AssistantMessage | MessageV2.Info; parts: Part[] } {
  if (!left) return false
  if (!isHelperAssistantItem(left) || !isHelperAssistantItem(right)) return false
  const leftAgent = (left.data as AssistantMessage | MessageV2.Info | undefined)?.agent
  const rightAgent = (right.data as AssistantMessage | MessageV2.Info | undefined)?.agent
  return leftAgent === rightAgent
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
        status: previous.status === "active" || item.status === "active" ? "active" : item.status ?? previous.status,
        data: {
          ...previousData,
          id: `${previousData.id}__${itemData.id}`,
          time: {
            ...previousData.time,
            created: Math.min(previousData.time.created, itemData.time.created),
            completed: previousData.time.completed && itemData.time.completed
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

function annotatePhaseStats(
  items: RenderableStreamItem[],
  narrative: RunNarrativeItem[],
): void {
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
