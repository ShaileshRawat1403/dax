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

  return streamItems
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

  return streamItems
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
  for (const item of items) {
    if (item.phase && (item.status === "active" || item.kind === "phase.marker")) {
      phases.add(item.phase)
    }
  }
  if (phases.size === 0) {
    phases.add("executing")
  }
  return phases
}

export { PHASE_ORDER, getPhaseLabel }
