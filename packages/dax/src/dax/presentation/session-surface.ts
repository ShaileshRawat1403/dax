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
  sessionStatusType: "busy" | "idle" | "retry"
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
    return { stage: "retrying", reason: "recovering from a failed attempt" }
  }

  if (input.pendingID) {
    const parts = input.partsForMessage(input.pendingID)
    const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
    const completedExecutionInTurn = parts.some(
      (part) => part.type === "tool" && part.state.status === "completed" && EXECUTE_TOOLS.has(part.tool),
    )

    if (pendingTool && pendingTool.type === "tool") {
      const tool = pendingTool.tool
      if (PLAN_TOOLS.has(tool)) return { stage: "planning", reason: `${tool} in progress` }
      if (EXECUTE_TOOLS.has(tool)) return { stage: "executing", reason: `${tool} in progress` }
      if (VERIFY_TOOLS.has(tool) && completedExecutionInTurn) {
        return { stage: "verifying", reason: `${tool} after execution` }
      }
      if (EXPLORE_TOOLS.has(tool)) return { stage: "exploring", reason: `${tool} in progress` }
      return { stage: "executing", reason: `${tool} in progress` }
    }

    const hasReasoning = parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)
    if (hasReasoning) return { stage: "thinking", reason: "reasoning stream active" }
    return { stage: "thinking", reason: "response stream active" }
  }

  if (input.sessionStatusType === "busy") {
    return { stage: "thinking", reason: "session processing" }
  }

  return { stage: "done", reason: "idle" }
}
