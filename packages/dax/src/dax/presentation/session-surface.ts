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
    case "reflection":
      return "recording reflection"
    default:
      return `${tool} in progress`
  }
}

export type OperatorTraceLine = {
  action: string
  target: string
  why: string
  result: string
  next: string
  summary: string
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

function extractTarget(part: any): string {
  const input = part?.state?.input ?? {}
  const metadata = part?.state?.metadata ?? {}
  const tool = String(part?.tool ?? "").toLowerCase()
  if (tool === "shell") return summarizeValue(input.command, 56) ?? "shell command"
  if (tool === "reflection") return summarizeValue(input.goal, 56) ?? "execution reflection"
  if (tool === "read" || tool === "write" || tool === "edit") {
    return normalizePathLike(input.filePath ?? input.path) ?? "workspace file"
  }
  if (tool === "apply_patch") {
    return normalizePathLike(metadata.filePath ?? input.filePath) ?? "workspace patch"
  }
  if (tool === "grep" || tool === "codesearch" || tool === "websearch") {
    return summarizeValue(stripQuotes(input.pattern ?? input.query), 56) ?? "search query"
  }
  if (tool === "glob" || tool === "list") {
    return summarizeValue(input.pattern ?? input.path, 56) ?? "workspace listing"
  }
  if (tool === "webfetch") return summarizeValue(input.url, 56) ?? "external URL"
  if (tool === "task" || tool === "question" || tool === "skill") {
    return summarizeValue(input.description ?? input.prompt ?? input.name, 56) ?? "operator step"
  }
  return summarizeValue(input.filePath ?? input.path ?? input.query ?? input.pattern ?? input.command, 56) ?? "runtime target"
}

function deriveWhy(tool: string) {
  switch (tool) {
    case "read":
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
    case "websearch":
    case "webfetch":
      return "gather context"
    case "task":
    case "todowrite":
    case "question":
    case "skill":
    case "reflection":
      return "shape execution plan"
    case "write":
    case "edit":
    case "apply_patch":
      return "apply scoped change"
    case "shell":
      return "execute workflow command"
    default:
      return "advance current run"
  }
}

function deriveResult(part: any) {
  const status = String(part?.state?.status ?? "pending").toLowerCase()
  const metadata = part?.state?.metadata ?? {}
  if (status === "pending" || status === "running") return "in progress"
  if (status === "error" || status === "failed") return "failed"
  if (status !== "completed") return status

  if (typeof metadata?.exitCode === "number") return metadata.exitCode === 0 ? "completed (exit 0)" : `completed (exit ${metadata.exitCode})`
  if (typeof metadata?.matchCount === "number") return `completed (${metadata.matchCount} match${metadata.matchCount === 1 ? "" : "es"})`
  if (Array.isArray(metadata?.matches)) return `completed (${metadata.matches.length} match${metadata.matches.length === 1 ? "" : "es"})`
  if (Array.isArray(metadata?.paths)) return `completed (${metadata.paths.length} path${metadata.paths.length === 1 ? "" : "s"})`
  if (metadata?.written === true) return "completed (workspace updated)"
  if (metadata?.read === true) return "completed (content loaded)"
  return "completed"
}

function deriveNext(tool: string, result: string) {
  const done = result.startsWith("completed")
  switch (tool) {
    case "read":
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
    case "websearch":
    case "webfetch":
      return done ? "decide next operation" : "wait for context"
    case "task":
    case "todowrite":
    case "question":
    case "skill":
    case "reflection":
      return done ? "continue plan execution" : "wait for planning step"
    case "write":
    case "edit":
    case "apply_patch":
      return done ? "run verification" : "wait for mutation"
    case "shell":
      return done ? "capture evidence and verify" : "wait for command completion"
    default:
      return done ? "continue governed run" : "wait for tool completion"
  }
}

function normalizeAction(tool: string) {
  const upper = tool.toUpperCase()
  if (upper === "TODOWRITE") return "TODO"
  if (upper === "APPLY_PATCH") return "PATCH"
  return upper
}

export function deriveOperatorTraceLine(part: Part): OperatorTraceLine | undefined {
  if (part.type !== "tool") return
  const tool = String(part.tool ?? "").toLowerCase()
  const action = normalizeAction(tool)
  const target = extractTarget(part)
  const why = deriveWhy(tool)
  const result = deriveResult(part)
  const next = deriveNext(tool, result)
  return {
    action,
    target,
    why,
    result,
    next,
    summary: `${action} ${target} · ${result}`,
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
