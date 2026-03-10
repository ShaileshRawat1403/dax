import type { Argv } from "yargs"
import { EOL } from "os"
import path from "path"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Locale } from "../../util/locale"
import type { MessageV2 } from "../../session/message-v2"

type ArtifactKind = "attachment" | "truncated_output" | "session_diff"

export type ArtifactRow = {
  id: string
  kind: ArtifactKind
  session_id: string
  label: string
  source: string
  created_at?: number
  reference?: string
}

export const ArtifactsCommand = cmd({
  command: "artifacts",
  describe: "inspect retained execution outputs linked to DAX work",
  builder: (yargs: Argv) =>
    yargs
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("session", {
        describe: "filter artifacts for a related session id",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const rows = await collectArtifacts()
      const filtered = rows
        .filter((row) => !args.session || row.session_id === args.session)
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))

      if (args.format === "json") {
        console.log(JSON.stringify(filtered, null, 2))
        return
      }

      console.log(formatArtifactTable(filtered))
    })
  },
})

export async function collectArtifacts() {
  const rows: ArtifactRow[] = []
  for await (const session of Session.list()) {
    if (session.parentID) continue
    const messages = await Session.messages({ sessionID: session.id })
    const diffs = await Session.diff(session.id)
    rows.push(...buildArtifactsForSession(session, messages, diffs))
  }
  return rows
}

export function buildArtifactsForSession(
  session: Session.Info,
  messages: MessageV2.WithParts[],
  diffs: Awaited<ReturnType<typeof Session.diff>>,
) {
  const rows: ArtifactRow[] = []

  if (diffs.length > 0) {
    rows.push({
      id: `diff:${session.id}`,
      kind: "session_diff",
      session_id: session.id,
      label: session.summary?.files ? `${session.summary.files} changed file${session.summary.files === 1 ? "" : "s"}` : "Session diff",
      source: "session diff",
      created_at: session.time.updated,
      reference: diffs.map((diff) => diff.file).join(", "),
    })
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue

      const completedAt = part.state.time.end
      const title = part.state.title || `${part.tool} output`

      for (const [index, attachment] of (part.state.attachments ?? []).entries()) {
        rows.push({
          id: `${part.id}:attachment:${index}`,
          kind: "attachment",
          session_id: part.sessionID,
          label: attachment.filename || title,
          source: `${part.tool} attachment`,
          created_at: completedAt,
          reference: describeAttachment(attachment),
        })
      }

      const outputPath = typeof part.state.metadata?.outputPath === "string" ? part.state.metadata.outputPath : undefined
      if (outputPath) {
        rows.push({
          id: `${part.id}:truncated`,
          kind: "truncated_output",
          session_id: part.sessionID,
          label: title,
          source: `${part.tool} truncated output`,
          created_at: completedAt,
          reference: normalizeReference(outputPath),
        })
      }
    }
  }

  return rows
}

function describeAttachment(attachment: MessageV2.FilePart) {
  if (attachment.filename) return attachment.filename
  if (attachment.source?.type === "file") return normalizeReference(attachment.source.path)
  if (attachment.source?.type === "resource") return attachment.source.uri
  return attachment.url
}

function normalizeReference(input: string) {
  if (!input) return input
  if (input.startsWith("file://")) {
    try {
      return normalizeReference(new URL(input).pathname)
    } catch {
      return input
    }
  }
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

export function formatArtifactTable(rows: ArtifactRow[]) {
  if (rows.length === 0) return "No retained artifacts."

  return rows
    .map((row) =>
      [
        `Artifact ID: ${row.id}`,
        `Kind: ${formatKind(row.kind)}`,
        `Label: ${row.label}`,
        `Related session: ${row.session_id}`,
        `Source: ${row.source}`,
        row.created_at ? `Created: ${Locale.todayTimeOrDateTime(row.created_at)}` : undefined,
        row.reference ? `Reference: ${row.reference}` : undefined,
      ]
        .filter(Boolean)
        .join(EOL),
    )
    .join(`${EOL}${"─".repeat(72)}${EOL}`)
}

function formatKind(kind: ArtifactKind) {
  switch (kind) {
    case "attachment":
      return "Attachment"
    case "truncated_output":
      return "Truncated output"
    case "session_diff":
      return "Session diff"
  }
}
