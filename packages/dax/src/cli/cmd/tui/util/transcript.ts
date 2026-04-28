import type { AssistantMessage, Part, UserMessage } from "@dax-ai/sdk/v2"
import { Locale } from "@/util/locale"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br />").trim()
}

function markdownTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(escapeTableCell).join(" | ")} |`
  const divider = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${row.map((cell) => escapeTableCell(cell)).join(" | ")} |`)
  return [header, divider, ...body].join("\n")
}

function summarizeValue(value: unknown, max = 96): string {
  if (value === null || value === undefined) return ""
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(1, ms)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
}

function buildTranscriptSummary(session: SessionInfo, messages: MessageWithParts[]): string {
  const userMessages = messages.filter((message) => message.info.role === "user").length
  const assistantMessages = messages.filter((message) => message.info.role === "assistant").length
  const toolCalls = messages.reduce(
    (count, message) => count + message.parts.filter((part) => part.type === "tool").length,
    0,
  )
  const reasoningBlocks = messages.reduce(
    (count, message) => count + message.parts.filter((part) => part.type === "reasoning").length,
    0,
  )

  const overviewTable = markdownTable(
    ["Field", "Value"],
    [
      ["Session", session.title],
      ["Session ID", session.id],
      ["Created", new Date(session.time.created).toLocaleString()],
      ["Updated", new Date(session.time.updated).toLocaleString()],
    ],
  )

  const statsTable = markdownTable(
    ["Metric", "Value"],
    [
      ["User turns", String(userMessages)],
      ["Assistant turns", String(assistantMessages)],
      ["Tool calls", String(toolCalls)],
      ["Reasoning blocks", String(reasoningBlocks)],
    ],
  )

  return `## Session Overview\n\n${overviewTable}\n\n## Conversation Summary\n\n${statsTable}\n\n---\n\n`
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += buildTranscriptSummary(session, messages)

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    const time =
      "time" in part.state && part.state.time && typeof part.state.time.start === "number"
        ? (part.state.time as { start: number; end?: number })
        : undefined
    const timing =
      typeof time?.end === "number" && time.end >= time.start ? formatDurationMs(time.end - time.start) : ""
    const summaryTable = markdownTable(
      ["Tool", "Status", "Duration", "Summary"],
      [
        [
          String(part.tool),
          String(part.state.status),
          timing,
          summarizeValue(
            part.state.status === "completed" ? part.state.output : part.state.status === "error" ? part.state.error : "",
            120,
          ),
        ],
      ],
    )

    let result = `${summaryTable}\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`
    }
    result += `\n`
    return result
  }

  return ""
}
