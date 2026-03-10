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
import { deriveSessionLifecycleFromMessages, type SessionLifecycleState, type SessionLifecycleSummary } from "../../session/lifecycle"
import {
  collectSessionVerification,
  type SessionVerification,
  type VerificationResult,
  type VerificationTrustPosture,
} from "../../trust/verify-session"
import { buildAuditSummary, type AuditPosture } from "./audit"

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

export type SessionHistoryOutcome = "active" | "blocked" | "completed" | "archived"
export type SDLCStage = "discovery" | "planning" | "implementation" | "verification" | "review" | "release_preparation"

export type SessionHistoryRow = {
  id: string
  title: string
  updated: number
  created: number
  outcome: SessionHistoryOutcome
  trust_posture: VerificationTrustPosture
  verification_result: VerificationResult
}

export type SessionShowSummary = {
  id: string
  title: string
  project_id: string
  directory: string
  created: number
  updated: number
  outcome: SessionHistoryOutcome
  lifecycle_state: SessionLifecycleState
  lifecycle_terminal: boolean
  lifecycle_requires_reconciliation: boolean
  trust_posture: VerificationTrustPosture
  verification_result: VerificationResult
  stage: SDLCStage
  artifact_count: number
  approval_count: number
  override_count: number
  timeline_count: number
  audit_posture: AuditPosture
  latest_activity_at?: number
}

export type SessionInspectSummary = {
  type: "session_inspect"
  summary: SessionShowSummary
  stages_reached: SDLCStage[]
  timeline: SessionTimelineRow[]
  artifacts: ArtifactRow[]
  audit: Awaited<ReturnType<typeof buildAuditSummary>>
  verification: SessionVerification
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
    yargs
      .command(SessionListCommand)
      .command(SessionShowCommand)
      .command(SessionInspectCommand)
      .command(SessionTimelineCommand)
      .command(SessionPruneCommand)
      .demandCommand(),
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

      const history = await collectSessionHistoryRows(limitedSessions)

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(history)
      } else {
        output = formatSessionTable(history)
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

export async function collectSessionHistoryRows(sessions: Session.Info[]) {
  const rows = await Promise.all(
    sessions.map(async (session) => {
      const [timeline, verification] = await Promise.all([
        collectSessionTimeline(session.id).catch(() => [] as SessionTimelineRow[]),
        collectSessionVerification(session.id).catch(() => fallbackVerification(session.id)),
      ])

      return toSessionHistoryRow({
        session,
        timeline,
        lifecycle: {
          lifecycle_state: verification.lifecycle_state,
          terminal: verification.lifecycle_terminal,
          requires_reconciliation: verification.lifecycle_requires_reconciliation,
          execution_started: true,
        },
        verification,
      })
    }),
  )

  return rows.sort((a, b) => b.updated - a.updated)
}

export function formatSessionTable(rows: SessionHistoryRow[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...rows.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...rows.map((s) => s.title.length))
  const maxOutcomeWidth = Math.max(9, ...rows.map((row) => formatSessionOutcome(row.outcome).length))
  const maxTrustWidth = Math.max(12, ...rows.map((row) => formatSessionTrustPosture(row.trust_posture).length))
  const maxVerificationWidth = Math.max(12, ...rows.map((row) => formatVerificationResultLabel(row.verification_result).length))

  const header = [
    `Session ID${" ".repeat(maxIdWidth - 10)}`,
    `Title${" ".repeat(maxTitleWidth - 5)}`,
    `Outcome${" ".repeat(maxOutcomeWidth - 7)}`,
    `Trust${" ".repeat(maxTrustWidth - 5)}`,
    `Verification${" ".repeat(maxVerificationWidth - 12)}`,
    "Updated",
  ].join("  ")
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of rows) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.updated)
    const line = [
      session.id.padEnd(maxIdWidth),
      truncatedTitle.padEnd(maxTitleWidth),
      formatSessionOutcome(session.outcome).padEnd(maxOutcomeWidth),
      formatSessionTrustPosture(session.trust_posture).padEnd(maxTrustWidth),
      formatVerificationResultLabel(session.verification_result).padEnd(maxVerificationWidth),
      timeStr,
    ].join("  ")
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: SessionHistoryRow[]): string {
  return JSON.stringify(sessions, null, 2)
}

export const SessionShowCommand = cmd({
  command: "show <session-id>",
  describe: "show a concise durable summary for one session",
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
      const summary = await collectSessionShowSummary(sessionID)

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatSessionShowSummary(summary))
    })
  },
})

export const SessionInspectCommand = cmd({
  command: "inspect <session-id>",
  describe: "inspect a session's durable record across timeline, artifacts, audit, and verification",
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
      const summary = await collectSessionInspectSummary(sessionID)

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatSessionInspectSummary(summary))
    })
  },
})

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

export async function collectSessionShowSummary(sessionID: string): Promise<SessionShowSummary> {
  const session = await Session.get(sessionID)
  const [messages, diffs, timeline, verification, auditSummary, pendingApprovals, events] = await Promise.all([
    Session.messages({ sessionID }),
    Session.diff(sessionID),
    collectSessionTimeline(sessionID),
    collectSessionVerification(sessionID).catch(() => fallbackVerification(sessionID)),
    buildAuditSummary({ sessionID }),
    listTimelineApprovals(sessionID),
    RAOLedger.list({
      project_id: Instance.project.id,
      limit: 200,
    }).then((rows) => rows.filter((row) => row.session_id === sessionID)),
  ])

  const artifacts = buildArtifactsForSession(session, messages, diffs)
  const lifecycle = deriveSessionLifecycleFromMessages({
    archivedAt: session.time.archived,
    pendingApprovalCount: pendingApprovals.length,
    retainedArtifactCount: artifacts.length,
    diffCount: diffs.length,
    messages,
  })
  const history = toSessionHistoryRow({
    session,
    timeline,
    lifecycle,
    verification,
  })

  return {
    id: session.id,
    title: session.title,
    project_id: session.projectID,
    directory: session.directory,
    created: session.time.created,
    updated: session.time.updated,
    outcome: history.outcome,
    lifecycle_state: lifecycle.lifecycle_state,
    lifecycle_terminal: lifecycle.terminal,
    lifecycle_requires_reconciliation: lifecycle.requires_reconciliation,
    trust_posture: verification.trust_posture,
    verification_result: verification.verification_result,
    stage: deriveSessionStage({
      timeline,
      approval_count: pendingApprovals.length,
      audit_posture: auditSummary.posture,
      verification_result: verification.verification_result,
    }),
    artifact_count: artifacts.length,
    approval_count: pendingApprovals.length,
    override_count: events.filter((row) => row.event_type === "override").length,
    timeline_count: timeline.length,
    audit_posture: auditSummary.posture,
    latest_activity_at: verification.latest_activity_at ?? auditSummary.latest_activity_at,
  }
}

export async function collectSessionInspectSummary(sessionID: string): Promise<SessionInspectSummary> {
  const session = await Session.get(sessionID)
  const [messages, diffs, timeline, verification, audit, summary] = await Promise.all([
    Session.messages({ sessionID }),
    Session.diff(sessionID),
    collectSessionTimeline(sessionID),
    collectSessionVerification(sessionID).catch(() => fallbackVerification(sessionID)),
    buildAuditSummary({ sessionID }),
    collectSessionShowSummary(sessionID),
  ])

  return {
    type: "session_inspect",
    summary,
    stages_reached: deriveStagesReached(timeline, summary.stage),
    timeline,
    artifacts: buildArtifactsForSession(session, messages, diffs),
    audit,
    verification,
  }
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

export function formatSessionShowSummary(summary: SessionShowSummary) {
  return [
    `Session: ${summary.id}`,
    `Title: ${summary.title}`,
    `Project: ${summary.project_id}`,
    `Directory: ${summary.directory}`,
    `Created: ${Locale.todayTimeOrDateTime(summary.created)}`,
    `Updated: ${Locale.todayTimeOrDateTime(summary.updated)}`,
    summary.latest_activity_at ? `Latest activity: ${Locale.todayTimeOrDateTime(summary.latest_activity_at)}` : undefined,
    "",
    `Outcome: ${formatSessionOutcome(summary.outcome)}`,
    `Lifecycle: ${formatSessionLifecycleState(summary.lifecycle_state)}${summary.lifecycle_requires_reconciliation ? " (needs reconciliation)" : ""}`,
    `Stage: ${formatSessionStage(summary.stage)}`,
    `Trust posture: ${formatSessionTrustPosture(summary.trust_posture)}`,
    `Verification: ${formatVerificationResultLabel(summary.verification_result)}`,
    `Audit posture: ${formatAuditPosture(summary.audit_posture)}`,
    "",
    "Session record",
    `- Timeline events: ${summary.timeline_count}`,
    `- Retained artifacts: ${summary.artifact_count}`,
    `- Pending approvals: ${summary.approval_count}`,
    `- Overrides recorded: ${summary.override_count}`,
  ]
    .filter(Boolean)
    .join(EOL)
}

export function formatSessionInspectSummary(summary: SessionInspectSummary) {
  const artifactPreview =
    summary.artifacts.length === 0
      ? ["- No retained artifacts."]
      : summary.artifacts
          .slice(0, 5)
          .map((artifact) => `- ${artifact.label} (${artifact.kind})`)
          .concat(summary.artifacts.length > 5 ? [`- ... and ${summary.artifacts.length - 5} more`] : [])

  const verificationPreview =
    summary.verification.checks.length === 0
      ? ["- No verification checks recorded."]
      : summary.verification.checks.map(
          (check) => `- ${check.label}: ${check.status}${check.summary ? ` — ${check.summary}` : ""}`,
        )

  return [
    formatSessionShowSummary(summary.summary),
    "",
    "Stage progression",
    `- Lifecycle: ${formatSessionLifecycleState(summary.summary.lifecycle_state)}${summary.summary.lifecycle_requires_reconciliation ? " (needs reconciliation)" : ""}`,
    `- Current stage: ${formatSessionStage(summary.summary.stage)}`,
    `- Stages reached: ${summary.stages_reached.map(formatSessionStage).join(" -> ")}`,
    "",
    "Timeline",
    summary.timeline.length === 0
      ? "No timeline events recorded for this session."
      : summary.timeline
          .map((row) => {
            const bits = [`- ${Locale.todayTimeOrDateTime(row.timestamp)} ${row.summary}`]
            if (row.reference) bits.push(`  Reference: ${row.reference}`)
            if (row.state_effect) bits.push(`  Effect: ${row.state_effect}`)
            return bits.join(EOL)
          })
          .join(EOL),
    "",
    "Artifacts",
    ...artifactPreview,
    "",
    "Audit",
    `- Posture: ${formatAuditPosture(summary.audit.posture)}`,
    `- Pending approvals: ${summary.audit.approvals.requested}`,
    `- Overrides: ${summary.audit.approvals.overrides}`,
    `- Findings: ${summary.audit.findings.status.toUpperCase()} (${summary.audit.findings.blocker_count} blockers, ${summary.audit.findings.warning_count} warnings, ${summary.audit.findings.info_count} info)`,
    "",
    "Verification",
    `- Result: ${formatVerificationResultLabel(summary.verification.verification_result)}`,
    `- Trust posture: ${formatSessionTrustPosture(summary.verification.trust_posture)}`,
    ...verificationPreview,
  ].join(EOL)
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

export function toSessionHistoryRow(input: {
  session: Session.Info
  timeline: SessionTimelineRow[]
  lifecycle: SessionLifecycleSummary
  verification: SessionVerification
}): SessionHistoryRow {
  return {
    id: input.session.id,
    title: input.session.title,
    updated: input.session.time.updated,
    created: input.session.time.created,
    outcome: deriveSessionHistoryOutcome(input.session, input.timeline, input.lifecycle),
    trust_posture: input.verification.trust_posture,
    verification_result: input.verification.verification_result,
  }
}

export function deriveSessionHistoryOutcome(
  session: Session.Info,
  timeline: SessionTimelineRow[],
  lifecycle: SessionLifecycleSummary,
): SessionHistoryOutcome {
  if (session.time.archived) return "archived"
  if (timeline.some((row) => row.type === "approval_requested")) return "blocked"
  if (lifecycle.lifecycle_state === "completed") return "completed"
  return "active"
}

function fallbackVerification(sessionID: string): SessionVerification {
  return {
    type: "session_verification",
    project_id: Instance.project.id,
    session_id: sessionID,
    lifecycle_state: "active",
    lifecycle_terminal: false,
    lifecycle_requires_reconciliation: false,
    verification_result: "verification_incomplete",
    trust_posture: "review_needed",
    checks: [],
    blocking_factors: [],
    degrading_factors: ["Verification could not be collected for this session."],
  }
}

function formatSessionOutcome(outcome: SessionHistoryOutcome) {
  switch (outcome) {
    case "active":
      return "Active"
    case "blocked":
      return "Blocked"
    case "completed":
      return "Completed"
    case "archived":
      return "Archived"
  }
}

function formatSessionLifecycleState(state: SessionLifecycleState) {
  switch (state) {
    case "active":
      return "Active"
    case "executing":
      return "Executing"
    case "completed":
      return "Completed"
    case "interrupted":
      return "Interrupted"
    case "abandoned":
      return "Abandoned"
  }
}

function formatSessionTrustPosture(posture: VerificationTrustPosture) {
  switch (posture) {
    case "review_needed":
      return "Review needed"
    case "policy_clean":
      return "Policy clean"
    case "verified":
      return "Verified"
  }
}

function formatVerificationResultLabel(result: VerificationResult) {
  switch (result) {
    case "verification_passed":
      return "Passed"
    case "verification_failed":
      return "Failed"
    case "verification_incomplete":
      return "Incomplete"
    case "verification_degraded":
      return "Degraded"
  }
}

function formatAuditPosture(posture: AuditPosture) {
  switch (posture) {
    case "clear":
      return "Clear"
    case "review_needed":
      return "Review needed"
    case "blocked":
      return "Blocked"
  }
}

export function deriveSessionStage(input: {
  timeline: SessionTimelineRow[]
  approval_count: number
  audit_posture: AuditPosture
  verification_result: VerificationResult
}): SDLCStage {
  if (input.approval_count > 0 || input.audit_posture !== "clear") return "review"
  if (input.verification_result !== "verification_incomplete") return "verification"

  const latest = input.timeline.at(-1)
  if (!latest) return "discovery"

  switch (latest.type) {
    case "session_created":
      return "discovery"
    case "plan_generated":
      return "planning"
    case "execution_started":
    case "execution_completed":
    case "artifact_produced":
      return "implementation"
    case "approval_requested":
    case "approval_resolved":
    case "audit_finding_recorded":
    case "trust_posture_changed":
      return "review"
    default:
      return "discovery"
  }
}

export function deriveStagesReached(timeline: SessionTimelineRow[], currentStage: SDLCStage): SDLCStage[] {
  const stages: SDLCStage[] = []
  const seen = new Set<SDLCStage>()

  const push = (stage: SDLCStage) => {
    if (seen.has(stage)) return
    seen.add(stage)
    stages.push(stage)
  }

  for (const row of timeline) {
    switch (row.type) {
      case "session_created":
        push("discovery")
        break
      case "plan_generated":
        push("planning")
        break
      case "execution_started":
      case "execution_completed":
      case "artifact_produced":
        push("implementation")
        break
      case "approval_requested":
      case "approval_resolved":
      case "audit_finding_recorded":
      case "trust_posture_changed":
        push("review")
        break
    }
  }

  push(currentStage)
  return stages
}

function formatSessionStage(stage: SDLCStage) {
  switch (stage) {
    case "discovery":
      return "Discovery"
    case "planning":
      return "Planning"
    case "implementation":
      return "Implementation"
    case "verification":
      return "Verification"
    case "review":
      return "Review"
    case "release_preparation":
      return "Release preparation"
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
