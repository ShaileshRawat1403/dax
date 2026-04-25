import type { Part, AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import type { ProjectedRun, RunNarrativeItem } from "@/server/run-contract"
import type { MessageV2 } from "@/session/message-v2"

// Agents that only appear as sub-tasks spawned by the `task` tool.
// Their messages are implementation details — the task BlockTool already surfaces
// a summary. Emitting them as stream items causes internal template text to leak.
const SUB_TASK_AGENTS = new Set([
  "explore",
  "explorer",
  "review",
  "reviewer",
  "verify",
  "verifier",
  "audit",
  "auditor",
  "summarize",
  "summarizer",
])

export type StreamItemKind =
  | "phase.marker"
  | "run.event"
  | "alert.inline"
  | "message.user"
  | "message.assistant"
  | "compaction.marker"

export type RunPhase = "understanding" | "planning" | "executing" | "verifying" | "complete"
export type StreamNarrativeSourceKind = "run-event" | "tool-trace" | "alert"

export interface StreamNarrativeDescriptor {
  label: string
  sentence: string
  now?: string
  next?: string
  evidence?: string
  sourceKind: StreamNarrativeSourceKind
}

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
  narrative?: StreamNarrativeDescriptor
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
    understanding: "Thinking",
    planning: "Planning",
    executing: "Executing",
    verifying: "Verifying",
    complete: "Complete",
  }[phase]
}

function summarizeValue(value: string | undefined, max = 72) {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function normalizePathLike(value: string | undefined) {
  if (!value) return undefined
  return summarizeValue(value.replace(/\\/g, "/"), 64)
}

function stripQuotes(value: string | undefined) {
  if (!value) return value
  return value.replace(/^['"]|['"]$/g, "")
}

function trimPunctuation(value: string | undefined) {
  if (!value) return undefined
  return value.replace(/[.:]+$/g, "").trim()
}

function sentenceCase(value: string | undefined) {
  const normalized = trimPunctuation(value)
  if (!normalized) return undefined
  return normalized[0]!.toUpperCase() + normalized.slice(1)
}

function joinSentences(...parts: Array<string | undefined>) {
  return parts
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" ")
    .trim()
}

function formatInlineCode(value: string) {
  return `\`${value}\``
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
}

function describeToolProgress(tool: string) {
  switch (tool) {
    case "read":
      return "reading files"
    case "glob":
      return "searching the workspace"
    case "grep":
      return "searching file contents"
    case "list":
      return "listing project files"
    case "shell":
      return "running a command"
    case "write":
      return "writing a file"
    case "edit":
      return "editing a file"
    case "apply_patch":
      return "patching files"
    case "task":
      return "structuring the task"
    case "todowrite":
      return "updating the checklist"
    case "question":
      return "waiting for clarification"
    case "skill":
      return "loading a skill"
    case "reflection":
      return "recording reflection"
    default:
      return `${tool} in progress`
  }
}

function extractToolTarget(part: Part): string {
  if (part.type !== "tool") return "runtime target"
  const input = part.state.input ?? {}
  const metadata = ("metadata" in part.state ? (part.state.metadata ?? {}) : {}) as Record<string, unknown>
  const tool = String(part.tool ?? "").toLowerCase()
  if (tool === "shell") return summarizeValue(String((input as any).command ?? ""), 56) ?? "shell command"
  if (tool === "reflection") return summarizeValue(String((input as any).goal ?? ""), 56) ?? "execution reflection"
  if (tool === "read" || tool === "write" || tool === "edit") {
    return normalizePathLike(String((input as any).filePath ?? (input as any).path ?? "")) ?? "workspace file"
  }
  if (tool === "apply_patch") {
    return (
      normalizePathLike(String((metadata.filePath as string | undefined) ?? (input as any).filePath ?? "")) ??
      "workspace patch"
    )
  }
  if (tool === "grep" || tool === "codesearch" || tool === "websearch") {
    return (
      summarizeValue(stripQuotes(String((input as any).pattern ?? (input as any).query ?? "")), 56) ?? "search query"
    )
  }
  if (tool === "glob" || tool === "list") {
    return summarizeValue(String((input as any).pattern ?? (input as any).path ?? ""), 56) ?? "workspace listing"
  }
  if (tool === "webfetch") return summarizeValue(String((input as any).url ?? ""), 56) ?? "external URL"
  if (tool === "task" || tool === "question" || tool === "skill") {
    return (
      summarizeValue(String((input as any).description ?? (input as any).prompt ?? (input as any).name ?? ""), 56) ??
      "operator step"
    )
  }
  return (
    summarizeValue(
      String(
        (input as any).filePath ??
          (input as any).path ??
          (input as any).query ??
          (input as any).pattern ??
          (input as any).command ??
          "",
      ),
      56,
    ) ?? "runtime target"
  )
}

function deriveToolEvidence(part: Part): string | undefined {
  if (part.type !== "tool") return undefined
  const status = String(part.state.status ?? "pending").toLowerCase()
  const metadata = ("metadata" in part.state ? (part.state.metadata ?? {}) : {}) as Record<string, unknown>
  if (status === "pending" || status === "running") return undefined
  if (status === "error" || status === "failed") return "Tool failed."
  // Non-zero exit is the only exit-code signal worth surfacing; zero exit and generic "Completed." are noise.
  if (typeof metadata.exitCode === "number" && metadata.exitCode !== 0)
    return `Exit ${metadata.exitCode}.`
  if (typeof metadata.matchCount === "number") {
    return `Found ${metadata.matchCount} match${metadata.matchCount === 1 ? "" : "es"}.`
  }
  if (Array.isArray(metadata.matches))
    return `Found ${metadata.matches.length} match${metadata.matches.length === 1 ? "" : "es"}.`
  if (Array.isArray(metadata.paths))
    return `Resolved ${metadata.paths.length} path${metadata.paths.length === 1 ? "" : "s"}.`
  return undefined
}

function deriveToolNext(_tool: string, _status: string): undefined {
  // "Next" for individual tool rows is noise — let the model's narrative prose carry it.
  return undefined
}

export function deriveToolNarrativeDescriptor(part: Part): StreamNarrativeDescriptor | undefined {
  if (part.type !== "tool") return undefined
  const tool = String(part.tool ?? "").toLowerCase()
  const target = extractToolTarget(part)
  const status = String(part.state.status ?? "pending").toLowerCase()
  const targetText = formatInlineCode(target)
  const evidence = deriveToolEvidence(part)
  const next = deriveToolNext(tool, status)

  const sentence = (() => {
    switch (tool) {
      case "read":
        // Path already shown in arg preview — narration would just repeat it.
        return undefined
      case "glob":
      case "list":
        return status === "completed"
          ? `Scanned ${targetText}.`
          : `Scanning ${targetText}.`
      case "grep":
      case "codesearch":
      case "websearch":
        return status === "completed"
          ? `Searched ${targetText}.`
          : `Searching ${targetText}.`
      case "webfetch":
        return status === "completed"
          ? `Fetched ${targetText}.`
          : `Fetching ${targetText}.`
      case "shell": {
        const rawCmd = String(((part.state as any).input as any)?.command ?? "").trim()
        const c = rawCmd.toLowerCase()
        if (/^git\s+status/.test(c)) return status === "completed" ? "Working tree checked." : "Checking working tree status."
        if (/^git\s+log/.test(c)) return status === "completed" ? "Commit history read." : "Reading commit history."
        if (/^git\s+diff/.test(c)) return status === "completed" ? "Diff captured." : "Diffing changes."
        if (/^git\s+stash/.test(c)) return status === "completed" ? "Stash applied." : "Applying stash."
        if (/^git\s+(add|commit|push|merge|rebase)/.test(c)) return status === "completed" ? "Git operation complete." : "Running git operation."
        if (/(bun|npm|pnpm|yarn)\s+test|jest|vitest|pytest|go\s+test|cargo\s+test/.test(c))
          return status === "completed" ? "Test suite complete." : "Running the test suite."
        if (/tsc|typecheck/.test(c)) return status === "completed" ? "Typecheck complete." : "Running the typecheck gate."
        if (/eslint|biome\s+check|ruff|oxlint/.test(c)) return status === "completed" ? "Lint complete." : "Running the linter."
        if (/(bun|npm|pnpm|yarn)\s+(run\s+)?build/.test(c)) return status === "completed" ? "Build complete." : "Building the project."
        if (/^cat\s|^head\s|^tail\s|^less\s/.test(c)) return undefined
        // Unrecognized commands: command in header is sufficient.
        return undefined
      }
      case "write":
        return status === "completed"
          ? `Wrote ${targetText}.`
          : `Writing ${targetText}.`
      case "edit":
        return status === "completed"
          ? `Edited ${targetText}.`
          : `Editing ${targetText}.`
      case "apply_patch":
        return status === "completed"
          ? `Patched ${targetText}.`
          : `Patching ${targetText}.`
      case "task":
        return status === "completed"
          ? `Task structured.`
          : `Structuring the task.`
      case "todowrite":
        return status === "completed"
          ? `Checklist updated.`
          : `Updating the checklist.`
      case "question":
        return status === "completed"
          ? `Question raised.`
          : `Waiting for a decision.`
      case "skill":
        return status === "completed"
          ? `Loaded ${targetText}.`
          : `Loading ${targetText}.`
      case "reflection":
        // Internal model grounding — already surfaces as intent.created prose. Suppress.
        return undefined
      default:
        return undefined
    }
  })()

  // reflection is internal grounding — suppress entirely (intent.created already surfaces it).
  if (tool === "reflection") return undefined

  const fullSentence = joinSentences(sentence, evidence)
  return {
    label: sentenceCase(describeToolProgress(tool)) ?? "Working",
    sentence: fullSentence,
    now: fullSentence ? stripInlineMarkdown(fullSentence) : "",
    next,
    evidence,
    sourceKind: "tool-trace",
  }
}

export function deriveLiveNarrativeStatus(input: {
  pendingID?: string
  partsForMessage: (messageID: string) => Part[]
}) {
  if (!input.pendingID) {
    return {
      status: "idle",
      now: "Ready.",
      next: undefined,
    }
  }

  const parts = input.partsForMessage(input.pendingID)
  const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
  if (pendingTool) {
    const narrative = deriveToolNarrativeDescriptor(pendingTool)
    if (narrative) {
      return {
        status: stripInlineMarkdown(narrative.label).toLowerCase(),
        now: stripInlineMarkdown(narrative.sentence),
        next: undefined,
      }
    }
  }

  const completedTool = parts.findLast((part) => part.type === "tool" && part.state.status === "completed")
  if (completedTool) {
    const narrative = deriveToolNarrativeDescriptor(completedTool)
    if (narrative) {
      return {
        status: `${stripInlineMarkdown(narrative.label).toLowerCase()} complete`,
        now: stripInlineMarkdown(narrative.sentence),
        next: undefined,
      }
    }
  }

  if (nonEmptyTextPart(parts, "reasoning")) {
    return {
      status: "thinking",
      now: "Reasoning through the options.",
      next: undefined,
    }
  }
  if (nonEmptyTextPart(parts, "text")) {
    return {
      status: "thinking",
      now: "Composing.",
      next: undefined,
    }
  }
  return {
    status: "loading",
    now: "Loading.",
    next: undefined,
  }
}

function nonEmptyTextPart(parts: Part[], type: "reasoning" | "text") {
  return parts.some((part) => part.type === type && part.text.trim().length > 0)
}

function deriveRunEventNarrative(item: RunNarrativeItem): StreamNarrativeDescriptor | undefined {
  const detail = sentenceCase(item.message) ?? "Progress updated"
  switch (item.type) {
    case "intent.created":
      return {
        label: "Goal",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: "Planning now.",
        sourceKind: "run-event",
      }
    case "plan.compiled":
      return {
        label: "Plan",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: "Starting.",
        sourceKind: "run-event",
      }
    case "step.failed":
      return {
        label: "Step failed",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: "Checking what went wrong.",
        sourceKind: "run-event",
      }
    case "artifact.created":
      return {
        label: "Evidence",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: undefined,
        sourceKind: "run-event",
      }
    case "audit.posture_updated":
      return {
        label: "Trust",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: undefined,
        sourceKind: "run-event",
      }
    case "run.completed":
      return {
        label: "Done",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: undefined,
        sourceKind: "run-event",
      }
    case "run.failed":
      return {
        label: "Run failed",
        sentence: `${detail}.`,
        now: `${detail}.`,
        next: undefined,
        sourceKind: "run-event",
      }
    default:
      return undefined
  }
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
    case "intent.created": {
      // Only surface intent text when it's a meaningful goal description.
      // Generic fallbacks like "Complete the request: hi" are just the user's message
      // echoed back — they add noise, not clarity.
      const msg = (item.message ?? "").toLowerCase().trim()
      if (msg.startsWith("complete the request:")) return false
      if (msg.startsWith("fulfill the request:")) return false
      if (!msg) return false
      return true
    }
    case "run.completed":
      return true
    case "step.failed":
      return true
    case "run.failed": {
      const msg = (item.message ?? "").toLowerCase().trim()
      if (!msg) return false
      if (msg === "run ended with status failed" || msg === "the run ended with status failed") return false
      return true
    }
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
      const narrativeDescriptor = deriveRunEventNarrative(item)
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
        narrative: narrativeDescriptor,
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
      narrative: {
        label:
          item.type === "approval.requested"
            ? "Approval required"
            : item.type === "intervention.required"
              ? "Intervention required"
              : "Alert",
        sentence: sentenceCase(item.message) ? `${sentenceCase(item.message)}.` : "Attention required.",
        now: sentenceCase(item.message) ? `${sentenceCase(item.message)}.` : "Attention required.",
        next:
          item.type === "approval.requested" || item.type === "intervention.required"
            ? "Review the queue and respond before continuing."
            : "Continue the run with the resolved decision in place.",
        sourceKind: "alert",
      },
    })
  }

  for (const message of messages) {
    if (message.role === "user") {
      const parts = partsByMessageId[message.id] ?? []
      const compactionPart = parts.find((p: any) => p.type === "compaction") as
        | { type: "compaction"; auto?: boolean }
        | undefined
      const hasTextPart = parts.some((p: any) => p.type === "text" && !p.synthetic)
      if (compactionPart && !hasTextPart) {
        // Internal compaction trigger — surface as a context checkpoint divider
        streamItems.push({
          id: `compaction-${message.id}`,
          kind: "compaction.marker",
          timestamp: message.time.created,
          status: "completed",
          message: compactionPart.auto ? "auto" : "manual",
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
      // Sub-task agents are spawned internally by the `task` tool — their messages are
      // captured inside the task BlockTool already; emitting them separately creates noise
      // and can leak internal prompt templates (e.g. "[file paths]" placeholders).
      const agentName: string | undefined = (message as any).agent?.toLowerCase()
      if (projectedRun && agentName && SUB_TASK_AGENTS.has(agentName)) {
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
      const compactionPart = parts.find((p: any) => p.type === "compaction") as
        | { type: "compaction"; auto?: boolean }
        | undefined
      const hasTextPart = parts.some((p: any) => p.type === "text" && !p.synthetic)
      if (compactionPart && !hasTextPart) {
        streamItems.push({
          id: `compaction-${message.id}`,
          kind: "compaction.marker",
          timestamp: message.time.created,
          status: "completed",
          message: compactionPart.auto ? "auto" : "manual",
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
