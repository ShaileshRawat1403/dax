import type { Part } from "@dax-ai/sdk/v2"
import type { StreamStage } from "@/dax/workflow/stage"

const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const PLAN_TOOLS = new Set(["task", "todowrite", "question", "skill"])
const EXECUTE_TOOLS = new Set(["write", "edit", "apply_patch", "shell"])
const VERIFY_TOOLS = new Set(["read", "grep", "list", "glob"])

export type AuditResult = {
  run_id: string
  timestamp: string
  profile: "strict" | "balanced" | "advisory"
  status: "pass" | "warn" | "fail"
  findings: unknown[]
  summary: {
    blocker_count: number
    warning_count: number
    info_count: number
  }
  next_actions: string[]
  metadata: {
    trigger: string
  }
}

export type AuditHistoryEntry = {
  commandText: string
  responseText: string
  result?: AuditResult
  createdAt: number
}

export type AssistantInsightCard = {
  eyebrow: string
  status: string
  rows: Array<{
    label: string
    value: string
  }>
  metrics: Array<{
    label: string
    value: string
    tone?: "primary" | "accent" | "muted"
  }>
  progressLine?: string
}

function nonEmptyTextPart(parts: Part[], type: "reasoning" | "text") {
  return parts.some((part) => part.type === type && part.text.trim().length > 0)
}

function titlecase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ")
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
    default:
      return `${tool} in progress`
  }
}

export function parseAuditResult(text: string): AuditResult | undefined {
  if (!text) return
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? text
  try {
    const parsed = JSON.parse(candidate) as AuditResult
    if (!parsed || !Array.isArray(parsed.findings) || !parsed.summary) return
    return parsed
  } catch {
    return
  }
}

export function deriveAuditHistory(input: {
  messages: Array<{
    id: string
    role: string
    parentID?: string
    time: { created: number }
  }>
  messageText: (messageID: string) => string
}) {
  const items: AuditHistoryEntry[] = []

  for (const message of input.messages) {
    if (message.role !== "user") continue
    const commandText = input.messageText(message.id)
    if (!commandText.startsWith("/audit")) continue
    const response = input.messages.find(
      (candidate) => candidate.role === "assistant" && candidate.parentID === message.id,
    )
    if (!response) continue
    const responseText = input.messageText(response.id)
    if (!responseText) continue
    items.push({
      commandText,
      responseText,
      result: parseAuditResult(responseText),
      createdAt: response.time.created,
    })
  }

  return items
}

export function deriveLiveSessionStageState(input: {
  permissionsCount: number
  questionsCount: number
  sessionStatusType: "busy" | "idle" | "retry" | "delayed"
  pendingID?: string
  partsForMessage: (messageID: string) => Part[]
}): { stage: StreamStage; reason: string } {
  if (input.permissionsCount > 0 || input.questionsCount > 0) {
    return {
      stage: "waiting",
      reason: input.permissionsCount > 0 ? "waiting for approval" : "waiting for user input",
    }
  }

  if (input.sessionStatusType === "retry") {
    return { stage: "retrying", reason: "provider cooldown in progress" }
  }

  if (input.sessionStatusType === "delayed") {
    return { stage: "thinking", reason: "waiting for provider response" }
  }

  if (input.pendingID) {
    const parts = input.partsForMessage(input.pendingID)
    const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
    const completedExecutionInTurn = parts.some(
      (part) => part.type === "tool" && part.state.status === "completed" && EXECUTE_TOOLS.has(part.tool),
    )

    if (pendingTool && pendingTool.type === "tool") {
      const tool = pendingTool.tool
      if (PLAN_TOOLS.has(tool)) return { stage: "planning", reason: describeToolProgress(tool) }
      if (EXECUTE_TOOLS.has(tool)) return { stage: "executing", reason: describeToolProgress(tool) }
      if (VERIFY_TOOLS.has(tool) && completedExecutionInTurn) {
        return { stage: "verifying", reason: "checking the result after execution" }
      }
      if (EXPLORE_TOOLS.has(tool)) return { stage: "exploring", reason: describeToolProgress(tool) }
      return { stage: "executing", reason: describeToolProgress(tool) }
    }

    const hasReasoning = parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)
    if (hasReasoning) return { stage: "thinking", reason: "working through the request" }
    return { stage: "thinking", reason: "response stream active" }
  }

  if (input.sessionStatusType === "busy") {
    return { stage: "thinking", reason: "session processing" }
  }

  return { stage: "done", reason: "idle" }
}

export function deriveLiveStreamStatus(input: {
  pendingID?: string
  partsForMessage: (messageID: string) => Part[]
}) {
  if (!input.pendingID) return "idle"

  const parts = input.partsForMessage(input.pendingID)
  const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
  if (pendingTool && pendingTool.type === "tool") return describeToolProgress(pendingTool.tool)

  const completedTool = parts.findLast((part) => part.type === "tool" && part.state.status === "completed")
  if (completedTool && completedTool.type === "tool") return `${describeToolProgress(completedTool.tool)} complete`

  if (nonEmptyTextPart(parts, "reasoning")) return "drafting the next step"
  if (nonEmptyTextPart(parts, "text")) return "answer streaming"
  return "waiting for provider response"
}

export function deriveStreamFidelitySnapshot(input: {
  pendingID?: string
  partsForMessage: (messageID: string) => Part[]
}) {
  const streamStatus = deriveLiveStreamStatus(input)
  if (!input.pendingID) {
    return {
      streamStatus,
      hasPendingTool: false,
      hasCompletedTool: false,
      hasVisibleReasoning: false,
      hasVisibleText: false,
    }
  }

  const parts = input.partsForMessage(input.pendingID)
  return {
    streamStatus,
    hasPendingTool: parts.some((part) => part.type === "tool" && part.state.status === "pending"),
    hasCompletedTool: parts.some((part) => part.type === "tool" && part.state.status === "completed"),
    hasVisibleReasoning: nonEmptyTextPart(parts, "reasoning"),
    hasVisibleText: nonEmptyTextPart(parts, "text"),
  }
}

export function deriveAssistantInsightCard(input: {
  asked: string
  doing: string
  next: string
  stage: string
  streamStatus: string
  durationMs: number
  totalTokens: number
  tokensPerSecond: number
  progress?: {
    bar: string
    current: number
    total: number
    percent: number
  } | null
}) : AssistantInsightCard {
  const metrics: AssistantInsightCard["metrics"] = [
    { label: "Stage", value: titlecase(input.stage), tone: "primary" as const },
    { label: "Stream", value: input.streamStatus, tone: "accent" as const },
  ]

  if (input.durationMs > 0) {
    metrics.push({
      label: "Runtime",
      value: `${Math.max(1, Math.round(input.durationMs / 1000))}s`,
      tone: "muted" as const,
    })
  }
  if (input.totalTokens > 0) {
    metrics.push({ label: "Tokens", value: input.totalTokens.toLocaleString(), tone: "muted" as const })
  }
  if (input.tokensPerSecond > 0) {
    metrics.push({ label: "Pace", value: `${input.tokensPerSecond.toFixed(0)}/s`, tone: "muted" as const })
  }

  return {
    eyebrow: input.progress ? "Live execution board" : "DAX response board",
    status: input.progress ? "active" : "steady",
    rows: [
      { label: "Mission", value: input.asked },
      { label: "Now", value: input.doing },
      { label: "Next", value: input.next },
    ],
    metrics,
    progressLine: input.progress
      ? `Flow  ${input.progress.bar}  Step ${input.progress.current}/${input.progress.total}  ${input.progress.percent}%`
      : undefined,
  }
}
