import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { Flag } from "../../flag/flag"
import { EOL } from "os"
import path from "path"
import { buildArtifactsForSession, type ArtifactRow } from "./artifacts"
import type { MessageV2 } from "../../session/message-v2"
import { RAOLedger } from "../../rao"
import { Instance } from "../../project/instance"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = Bun.which("less")
  if (lessOnPath) {
    if (Bun.file(lessOnPath).size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.DAX_GIT_BASH_PATH) {
    const less = path.join(Flag.DAX_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  const git = Bun.which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Bun.file(less).size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

type SessionSummary = {
  id: string
  title: string
  updated: number
  created: number
  projectId: string
  directory: string
}

type TimelineApproval = {
  id: string
  createdAt: number
  sessionID: string
  permission: string
  patterns?: string[]
}

type TimelineLedgerEvent = Awaited<ReturnType<typeof RAOLedger.list>>[number]

export type SessionTimelineEventType =
  | "session_created"
  | "plan_generated"
  | "execution_started"
  | "execution_completed"
  | "approval_requested"
  | "approval_resolved"
  | "artifact_produced"
  | "audit_finding_recorded"
  | "trust_posture_changed"

export type SessionTimelineRow = {
  id: string
  type: SessionTimelineEventType
  session_id: string
  timestamp: number
  source: "session" | "planning" | "execution" | "governance" | "artifact" | "audit"
  summary: string
  reference?: string
  state_effect?: string
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs.command(SessionListCommand).command(SessionTimelineCommand).command(SessionPruneCommand).demandCommand(),
  async handler() {},
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = []
      for await (const session of Session.list()) {
        if (!session.parentID) {
          sessions.push(session)
        }
      }

      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

      if (limitedSessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(limitedSessions)
      } else {
        output = formatSessionTable(limitedSessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: pagerCmd(),
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

export const SessionPruneCommand = cmd({
  command: "prune",
  describe: "delete older sessions while keeping the most recent ones",
  builder: (yargs: Argv) =>
    yargs
      .option("keep", {
        alias: "k",
        describe: "keep N most recent top-level sessions",
        type: "number",
        default: 20,
      })
      .option("dry-run", {
        describe: "show what would be deleted without deleting",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("yes", {
        alias: "y",
        describe: "skip confirmation prompt",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const keep = Math.max(0, Math.floor(args.keep ?? 20))
      const sessions: Session.Info[] = []
      for await (const session of Session.list()) {
        if (!session.parentID) sessions.push(session)
      }
      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const keepSessions = sessions.slice(0, keep)
      const pruneSessions = sessions.slice(keep)

      const summary = {
        projectId: keepSessions[0]?.projectID ?? pruneSessions[0]?.projectID ?? "",
        total: sessions.length,
        keep,
        kept: keepSessions.length,
        prune: pruneSessions.length,
        sessions: pruneSessions.map(toSessionSummary),
      }

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
      } else {
        renderPruneSummary(summary)
      }

      if (pruneSessions.length === 0) {
        if (args.format !== "json") prompts.outro("No sessions need pruning")
        return
      }

      if (args.dryRun) {
        if (args.format !== "json") prompts.outro("Dry run only; no sessions deleted")
        return
      }

      if (!args.yes) {
        const confirm = await prompts.confirm({
          message: `Delete ${pruneSessions.length} older sessions and keep ${keepSessions.length}?`,
          initialValue: false,
        })
        if (!confirm || prompts.isCancel(confirm)) {
          prompts.outro("Cancelled")
          return
        }
      }

      const spinner = prompts.spinner()
      spinner.start(`Deleting ${pruneSessions.length} older sessions...`)
      for (const session of pruneSessions) {
        await Session.remove(session.id)
      }
      spinner.stop(`Deleted ${pruneSessions.length} sessions`)
      prompts.outro(`Kept ${keepSessions.length} recent sessions`)
    })
  },
})

export const SessionTimelineCommand = cmd({
  command: "timeline <session-id>",
  describe: "inspect meaningful progression for a session",
  builder: (yargs: Argv) =>
    yargs
      .positional("session-id", {
        describe: "session id to inspect",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = String(args["session-id"])
      const rows = await collectSessionTimeline(sessionID)
      if (args.format === "json") {
        console.log(JSON.stringify(rows, null, 2))
        return
      }
      console.log(formatSessionTimeline(rows))
    })
  },
})

export async function collectSessionTimeline(sessionID: string) {
  const session = await Session.get(sessionID)
  const [messages, diffs, pendingApprovals, ledgerEvents] = await Promise.all([
    Session.messages({ sessionID }),
    Session.diff(sessionID),
    listTimelineApprovals(sessionID),
    RAOLedger.list({
      project_id: Instance.project.id,
      limit: 200,
    }).then((rows) => rows.filter((row) => row.session_id === sessionID)),
  ])

  const artifacts = buildArtifactsForSession(session, messages, diffs)
  const planPath = Session.plan({ slug: session.slug, time: session.time })
  const planGeneratedAt = await Bun.file(planPath)
    .exists()
    .then(async (exists) => (exists ? (await Bun.file(planPath).stat()).mtimeMs : undefined))
    .catch(() => undefined)

  return buildSessionTimelineRows({
    session,
    messages,
    approvals: pendingApprovals,
    artifacts,
    ledgerEvents,
    planGeneratedAt,
    planReference: path.relative(process.cwd(), planPath) || ".",
  })
}

export function buildSessionTimelineRows(input: {
  session: Session.Info
  messages: MessageV2.WithParts[]
  approvals: TimelineApproval[]
  artifacts: ArtifactRow[]
  ledgerEvents: TimelineLedgerEvent[]
  planGeneratedAt?: number
  planReference?: string
}) {
  const rows: SessionTimelineRow[] = []

  rows.push({
    id: `session:${input.session.id}`,
    type: "session_created",
    session_id: input.session.id,
    timestamp: input.session.time.created,
    source: "session",
    summary: `Session created: ${input.session.title}`,
    state_effect: "lifecycle created",
  })

  if (typeof input.planGeneratedAt === "number") {
    rows.push({
      id: `plan:${input.session.id}`,
      type: "plan_generated",
      session_id: input.session.id,
      timestamp: input.planGeneratedAt,
      source: "planning",
      summary: "Plan generated for this session",
      reference: input.planReference,
      state_effect: "lifecycle planning",
    })
  }

  const firstAssistant = input.messages.find((message) => message.info.role === "assistant")
  if (firstAssistant && firstAssistant.info.role === "assistant") {
    rows.push({
      id: `execution:${firstAssistant.info.id}`,
      type: "execution_started",
      session_id: input.session.id,
      timestamp: firstAssistant.info.time.created,
      source: "execution",
      summary: "Execution started",
      state_effect: "lifecycle executing",
    })
  }

  const lastMessage = input.messages.at(-1)
  const hasCompletionSignal =
    !!lastMessage &&
    input.messages.length > 2 &&
    input.approvals.length === 0 &&
    input.session.time.updated > (firstAssistant?.info.time.created ?? input.session.time.created)
  if (hasCompletionSignal) {
    rows.push({
      id: `execution:completed:${input.session.id}`,
      type: "execution_completed",
      session_id: input.session.id,
      timestamp: Math.max(input.session.time.updated, lastMessage!.info.time.created),
      source: "execution",
      summary: "Execution completed",
      state_effect: "lifecycle completed",
    })
  }

  for (const approval of input.approvals) {
    rows.push({
      id: `approval:${approval.id}`,
      type: "approval_requested",
      session_id: input.session.id,
      timestamp: approval.createdAt,
      source: "governance",
      summary: `Approval requested for ${formatPermissionReference(approval.permission)}`,
      reference: summarizeReferenceList(approval.patterns?.filter(Boolean) ?? []),
      state_effect: "lifecycle awaiting_approval",
    })
  }

  for (const artifactGroup of groupArtifacts(input.artifacts, input.session.time.updated)) {
    rows.push({
      id: artifactGroup.id,
      type: "artifact_produced",
      session_id: input.session.id,
      timestamp: artifactGroup.timestamp,
      source: "artifact",
      summary: artifactGroup.summary,
      reference: artifactGroup.reference,
      state_effect: artifactGroup.stateEffect,
    })
  }

  for (const row of input.ledgerEvents) {
    if (row.event_type === "override") {
      const reply = typeof row.payload.reply === "string" ? row.payload.reply : "resolved"
      const permission = typeof row.payload.permission === "string" ? row.payload.permission : "approval"
      rows.push({
        id: `override:${row.id}`,
        type: "approval_resolved",
        session_id: input.session.id,
        timestamp: row.created_at,
        source: "governance",
        summary: approvalResolutionSummary(reply, permission),
        reference: formatPermissionReference(permission),
        state_effect: "approval state changed",
      })
      continue
    }

    if (row.event_type !== "audit") continue

    if ("run_id" in row.payload) {
      const blockers = asNumber(row.payload.blockers)
      const warnings = asNumber(row.payload.warnings)
      rows.push({
        id: `audit:${row.id}`,
        type: "audit_finding_recorded",
        session_id: input.session.id,
        timestamp: row.created_at,
        source: "audit",
        summary: formatAuditFindingSummary(blockers, warnings),
        reference: typeof row.payload.run_id === "string" ? row.payload.run_id : undefined,
        state_effect: blockers > 0 ? "trust blockers recorded" : warnings > 0 ? "trust warnings recorded" : undefined,
      })

      rows.push({
        id: `trust:${row.id}`,
        type: "trust_posture_changed",
        session_id: input.session.id,
        timestamp: row.created_at,
        source: "audit",
        summary: `Trust posture updated to ${auditStatusToTrustLabel(typeof row.payload.status === "string" ? row.payload.status : "warn")}`,
        state_effect: `trust ${auditStatusToTrustLabel(typeof row.payload.status === "string" ? row.payload.status : "warn")}`,
      })
      continue
    }

    if (row.payload.action === "ask") {
      const permission = typeof row.payload.permission === "string" ? row.payload.permission : "approval"
      const pattern = typeof row.payload.pattern === "string" ? row.payload.pattern : undefined
      rows.push({
        id: `governance:${row.id}`,
        type: "approval_requested",
        session_id: input.session.id,
        timestamp: row.created_at,
        source: "governance",
        summary: `Approval requested for ${formatPermissionReference(permission)}`,
        reference: formatPatternReference(pattern),
        state_effect: "lifecycle awaiting_approval",
      })
    }
  }

  const deduped = new Map<string, SessionTimelineRow>()
  for (const row of rows) deduped.set(row.id, row)

  return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
}

export function formatSessionTimeline(rows: SessionTimelineRow[]) {
  if (rows.length === 0) return "No timeline events recorded for this session."

  return rows
    .map((row) =>
      [
        `${Locale.todayTimeOrDateTime(row.timestamp)}  ${formatTimelineType(row.type)}`,
        row.summary,
        row.state_effect ? `Effect: ${row.state_effect}` : undefined,
        row.reference ? `Reference: ${row.reference}` : undefined,
      ]
        .filter(Boolean)
        .join(EOL),
    )
    .join(`${EOL}${"─".repeat(72)}${EOL}`)
}

function formatTimelineType(type: SessionTimelineEventType) {
  switch (type) {
    case "session_created":
      return "Session created"
    case "plan_generated":
      return "Plan generated"
    case "execution_started":
      return "Execution started"
    case "execution_completed":
      return "Execution completed"
    case "approval_requested":
      return "Approval requested"
    case "approval_resolved":
      return "Approval resolved"
    case "artifact_produced":
      return "Artifact produced"
    case "audit_finding_recorded":
      return "Audit finding recorded"
    case "trust_posture_changed":
      return "Trust posture changed"
  }
}

function auditStatusToTrustLabel(status: string) {
  switch (status) {
    case "fail":
      return "blocked"
    case "pass":
      return "policy_clean"
    default:
      return "review_needed"
  }
}

function formatAuditFindingSummary(blockers: number, warnings: number) {
  if (blockers + warnings === 0) return "Audit completed with no issues"
  if (blockers > 0 && warnings > 0) return `Audit issues detected: ${countLabel(blockers, "blocker")}, ${countLabel(warnings, "warning")}`
  if (blockers > 0) return `Audit issues detected: ${countLabel(blockers, "blocker")}`
  return `Audit issues detected: ${countLabel(warnings, "warning")}`
}

function approvalResolutionSummary(reply: string, permission: string) {
  const scope = formatPermissionReference(permission)
  switch (reply) {
    case "always":
    case "once":
    case "allow":
      return `Approval granted for ${scope}`
    case "reject":
    case "deny":
      return `Approval rejected for ${scope}`
    default:
      return `Approval resolved for ${scope}`
  }
}

function formatPermissionReference(permission: string) {
  switch (permission) {
    case "bash":
      return "command execution"
    case "edit":
      return "file edits"
    case "read":
      return "file access"
    case "external_directory":
      return "external directory access"
    default:
      return permission
  }
}

function formatPatternReference(pattern?: string) {
  if (!pattern) return undefined
  if (pattern.includes(",")) return summarizeReferenceList(pattern.split(",").map((item) => item.trim()).filter(Boolean))
  if (pattern.includes("/")) return shortenPathReference(pattern)
  return Locale.truncate(pattern, 80)
}

function shortenPathReference(reference: string) {
  if (reference.includes("tool-output/")) return path.basename(reference)
  return path.basename(reference) || Locale.truncate(reference, 80)
}

function summarizeReferenceList(items: string[]) {
  if (items.length === 0) return undefined
  const labels = items.map((item) => shortenPathReference(item))
  if (labels.length <= 3) return labels.join(", ")
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`
}

function groupArtifacts(artifacts: ArtifactRow[], fallbackTimestamp: number) {
  if (artifacts.length === 0) return []

  const sorted = [...artifacts].sort(
    (a, b) => (a.created_at ?? fallbackTimestamp) - (b.created_at ?? fallbackTimestamp) || a.id.localeCompare(b.id),
  )

  const groups: ArtifactRow[][] = []
  for (const artifact of sorted) {
    const ts = artifact.created_at ?? fallbackTimestamp
    const current = groups.at(-1)
    if (!current) {
      groups.push([artifact])
      continue
    }
    const currentTs = current[0]!.created_at ?? fallbackTimestamp
    const sameBurst = ts - currentTs <= 90_000
    const sameKind = current.every((item) => item.kind === artifact.kind)
    if (sameBurst && sameKind) {
      current.push(artifact)
      continue
    }
    groups.push([artifact])
  }

  return groups.map((group, index) => formatArtifactGroup(group, fallbackTimestamp, index))
}

function formatArtifactGroup(group: ArtifactRow[], fallbackTimestamp: number, index: number) {
  const timestamp = group.at(-1)?.created_at ?? fallbackTimestamp
  if (group.length === 1) {
    const artifact = group[0]!
    return {
      id: `artifact:${artifact.id}`,
      timestamp,
      summary: singleArtifactSummary(artifact),
      reference: formatPatternReference(artifact.reference),
      stateEffect: "artifact attached",
    }
  }

  const labels = group.map((artifact) => artifactDisplayLabel(artifact))
  return {
    id: `artifact-group:${group[0]!.id}:${index}`,
    timestamp,
    summary: `Artifacts produced (${group.length})`,
    reference: summarizeReferenceList(labels),
    stateEffect: "artifacts attached",
  }
}

function singleArtifactSummary(artifact: ArtifactRow) {
  if (artifact.kind === "session_diff") return `Code changes captured: ${artifact.label}`
  return `Artifact produced: ${artifactDisplayLabel(artifact)}`
}

function artifactDisplayLabel(artifact: ArtifactRow) {
  if (artifact.kind === "session_diff") return artifact.label
  if (artifact.reference) {
    const shortened = formatPatternReference(artifact.reference)
    if (shortened && shortened !== artifact.reference) return shortened
  }
  return artifact.label
}

function countLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function listTimelineApprovals(sessionID: string): Promise<TimelineApproval[]> {
  const { PermissionNext } = await import("../../governance/next")
  const pending = await PermissionNext.list()
  return pending.filter((item) => item.sessionID === sessionID)
}

function toSessionSummary(session: Session.Info): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }
}

function renderPruneSummary(input: {
  total: number
  keep: number
  kept: number
  prune: number
  sessions: SessionSummary[]
}) {
  UI.empty()
  prompts.intro("Session prune")
  prompts.log.info(`Total sessions: ${input.total}`)
  prompts.log.info(`Keeping newest: ${input.kept}`)
  prompts.log.info(`Deleting older: ${input.prune}`)
  if (input.prune === 0) return
  prompts.log.message("Oldest sessions queued for deletion:")
  for (const session of input.sessions.slice(0, 10)) {
    prompts.log.info(`  • ${session.title} ${UI.Style.TEXT_DIM}(${Locale.todayTimeOrDateTime(session.updated)})`)
  }
  if (input.sessions.length > 10) {
    prompts.log.info(`  … and ${input.sessions.length - 10} more`)
  }
}
