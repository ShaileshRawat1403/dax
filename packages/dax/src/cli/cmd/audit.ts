import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { RAOLedger } from "../../rao"
import { Instance } from "../../project/instance"
import { Audit } from "../../audit"
import { PM } from "../../pm"
import { Config } from "../../config/config"
import { Session } from "../../session"
import { Locale } from "../../util/locale"
import { collectArtifacts } from "./artifacts"

type AuditEventRow = Awaited<ReturnType<typeof RAOLedger.list>>[number]

export type AuditPosture = "clear" | "review_needed" | "blocked"

export type AuditSummary = {
  type: "audit_summary"
  project_id: string
  session_id?: string
  posture: AuditPosture
  approvals: {
    requested: number
    overrides: number
  }
  evidence: {
    diff_present: boolean
    artifacts_present: boolean
    sessions_with_diffs: number
    artifact_count: number
  }
  findings: {
    status: Audit.Status
    blocker_count: number
    warning_count: number
    info_count: number
  }
  latest_activity_at?: number
  next_actions: string[]
}

export const AuditCommand = cmd({
  command: "audit",
  describe: "inspect trust posture or run SDLC audit workflows",
  builder: (yargs: Argv) =>
    yargs
      .command({
        command: "run",
        describe: "run SDLC audit",
        builder: (y) =>
          y
            .option("profile", {
              type: "string",
              choices: ["strict", "balanced", "advisory"],
              describe: "audit profile",
            })
            .option("json", {
              type: "boolean",
              default: false,
              describe: "print machine-readable JSON only",
            }),
        handler: async (args) => {
          await bootstrap(process.cwd(), async () => {
            const config = await Config.get()
            const result = await Audit.run({
              trigger: "manual",
              profile: args.profile as Audit.Profile | undefined,
              config,
            })
            if (args.json) {
              console.log(JSON.stringify(result, null, 2))
              return
            }
            console.log(Audit.toMarkdown(result))
            console.log("\n```json\n" + JSON.stringify(result, null, 2) + "\n```")
          })
        },
      })
      .command({
        command: "gate",
        describe: "run audit gate and return pass/fail status",
        builder: (y) =>
          y.option("profile", {
            type: "string",
            choices: ["strict", "balanced", "advisory"],
          }),
        handler: async (args) => {
          await bootstrap(process.cwd(), async () => {
            const result = await Audit.run({
              trigger: "before_release",
              profile: args.profile as Audit.Profile | undefined,
            })
            const gate = Audit.gate(result)
            console.log(gate.message)
            console.log(JSON.stringify(result, null, 2))
            if (!gate.pass) process.exitCode = 1
          })
        },
      })
      .command({
        command: "profile <value>",
        describe: "set default audit profile in PM preferences",
        builder: (y) =>
          y.positional("value", {
            type: "string",
            choices: ["strict", "balanced", "advisory"],
          }),
        handler: async (args) => {
          await bootstrap(process.cwd(), async () => {
            const value = String(args.value)
            await PM.set_preference({
              project_id: Instance.project.id,
              pref_key: "audit.profile",
              pref_value: value,
            })
            console.log(`Audit profile set to ${value}.`)
          })
        },
      })
      .command({
        command: "explain <id>",
        describe: "explain a finding from a fresh audit run",
        builder: (y) =>
          y
            .positional("id", {
              type: "string",
            })
            .option("profile", {
              type: "string",
              choices: ["strict", "balanced", "advisory"],
            }),
        handler: async (args) => {
          await bootstrap(process.cwd(), async () => {
            const result = await Audit.run({
              trigger: "manual",
              profile: args.profile as Audit.Profile | undefined,
            })
            const id = String(args.id)
            const finding = Audit.explain(result, id)
            if (!finding) {
              console.log(`Finding not found: ${id}`)
              process.exitCode = 1
              return
            }
            console.log(
              [
                `id: ${finding.id}`,
                `severity: ${finding.severity}${finding.blocking ? " (BLOCKER)" : ""}`,
                `category: ${finding.category}`,
                `title: ${finding.title}`,
                `evidence: ${finding.evidence}`,
                `impact: ${finding.impact}`,
                `fix: ${finding.fix}`,
                `owner_hint: ${finding.owner_hint}`,
              ].join("\n"),
            )
          })
        },
      })
      .command({
        command: "events",
        describe: "inspect raw RAO events when low-level audit history is needed",
        builder: (y) =>
          y
            .option("project", {
              describe: "project id to query (default: current project)",
              type: "string",
            })
            .option("type", {
              describe: "event type filter (run, audit, override)",
              type: "string",
            })
            .option("limit", {
              describe: "number of events to show (default: 50)",
              type: "number",
            }),
        handler: async (args) => {
          await bootstrap(process.cwd(), async () => {
            const projectID = args.project || Instance.project.id
            const limit = typeof args.limit === "number" ? args.limit : 50
            const eventType = typeof args.type === "string" ? args.type : undefined
            const rows = await RAOLedger.list({
              project_id: projectID,
              event_type: eventType as any,
              limit,
            })
            for (const row of rows) {
              const ts = new Date(row.created_at).toISOString()
              console.log(`${ts} ${row.event_type} ${JSON.stringify(row.payload)}`)
            }
          })
        },
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("session", {
        describe: "filter trust summary for a related session id",
        type: "string",
      })
      .demandCommand(0),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const summary = await buildAuditSummary({
        sessionID: typeof args.session === "string" ? args.session : undefined,
      })

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatAuditSummary(summary))
    })
  },
})

export async function buildAuditSummary(input?: { sessionID?: string }): Promise<AuditSummary> {
  const sessionID = input?.sessionID
  const [pendingApprovals, artifacts, auditResult, events] = await Promise.all([
    PermissionAwareApprovals.list(sessionID),
    collectArtifacts().then((rows) => rows.filter((row) => !sessionID || row.session_id === sessionID)),
    Audit.run({ trigger: "manual" }),
    RAOLedger.list({
      project_id: Instance.project.id,
      limit: 200,
    }).then((rows) => rows.filter((row) => !sessionID || row.session_id === sessionID)),
  ])

  const sessionDiffs = await listSessionDiffEvidence(sessionID)
  const overrides = events.filter((row) => row.event_type === "override")
  const evidence = {
    diff_present: sessionDiffs.length > 0,
    artifacts_present: artifacts.length > 0,
    sessions_with_diffs: sessionDiffs.length,
    artifact_count: artifacts.length,
  }

  const latest_activity_at = latestActivityTimestamp({
    events,
    artifacts,
    sessionDiffs,
  })

  return {
    type: "audit_summary",
    project_id: Instance.project.id,
    session_id: sessionID,
    posture: deriveAuditPosture({
      auditStatus: auditResult.status,
      blockerCount: auditResult.summary.blocker_count,
      pendingApprovalCount: pendingApprovals.length,
      overrideCount: overrides.length,
      evidence,
    }),
    approvals: {
      requested: pendingApprovals.length,
      overrides: overrides.length,
    },
    evidence,
    findings: {
      status: auditResult.status,
      blocker_count: auditResult.summary.blocker_count,
      warning_count: auditResult.summary.warning_count,
      info_count: auditResult.summary.info_count,
    },
    latest_activity_at,
    next_actions: summarizeNextActions({
      auditResult,
      pendingApprovalCount: pendingApprovals.length,
      overrideCount: overrides.length,
      evidence,
    }),
  }
}

async function listSessionDiffEvidence(sessionID?: string) {
  const result: Array<{ session_id: string; updated_at: number }> = []
  if (sessionID) {
    const session = await Session.get(sessionID).catch(() => undefined)
    if (!session) return result
    const diffs = await Session.diff(sessionID)
    if (diffs.length > 0) result.push({ session_id: sessionID, updated_at: session.time.updated })
    return result
  }

  for await (const session of Session.list()) {
    if (session.parentID) continue
    const diffs = await Session.diff(session.id)
    if (diffs.length === 0) continue
    result.push({ session_id: session.id, updated_at: session.time.updated })
  }
  return result
}

export function deriveAuditPosture(input: {
  auditStatus: Audit.Status
  blockerCount: number
  pendingApprovalCount: number
  overrideCount: number
  evidence: AuditSummary["evidence"]
}): AuditPosture {
  if (input.blockerCount > 0 || input.auditStatus === "fail") return "blocked"
  if (
    input.auditStatus === "warn" ||
    input.pendingApprovalCount > 0 ||
    input.overrideCount > 0 ||
    (!input.evidence.diff_present && !input.evidence.artifacts_present)
  ) {
    return "review_needed"
  }
  return "clear"
}

export function summarizeNextActions(input: {
  auditResult: Audit.Result
  pendingApprovalCount: number
  overrideCount: number
  evidence: AuditSummary["evidence"]
}) {
  const actions = [...input.auditResult.next_actions]
  if (input.pendingApprovalCount > 0) actions.unshift("Review pending approvals before continuing execution.")
  if (input.overrideCount > 0) actions.push("Review override decisions and confirm they were intentional.")
  if (!input.evidence.diff_present && !input.evidence.artifacts_present) {
    actions.push("Collect execution evidence before handoff or release review.")
  }
  return Array.from(new Set(actions)).slice(0, 5)
}

export function formatAuditSummary(summary: AuditSummary) {
  const context = summary.session_id ? `Session: ${summary.session_id}` : `Project: ${summary.project_id}`
  const posture = formatPosture(summary.posture)
  const findingsStatus = summary.findings.status.toUpperCase()

  const lines = [
    context,
    `Trust posture: ${posture}`,
    `Pending approvals: ${summary.approvals.requested}`,
    `Overrides recorded: ${summary.approvals.overrides}`,
    `Evidence present: ${formatEvidence(summary.evidence)}`,
    `Audit findings: ${findingsStatus} (${summary.findings.blocker_count} blockers, ${summary.findings.warning_count} warnings, ${summary.findings.info_count} info)`,
    summary.latest_activity_at ? `Latest activity: ${Locale.todayTimeOrDateTime(summary.latest_activity_at)}` : undefined,
  ].filter(Boolean)

  if (summary.next_actions.length === 0) return lines.join(EOL)

  return [
    lines.join(EOL),
    "",
    "Next actions:",
    ...summary.next_actions.map((action, index) => `${index + 1}. ${action}`),
  ].join(EOL)
}

function formatPosture(posture: AuditPosture) {
  switch (posture) {
    case "clear":
      return "Clear"
    case "review_needed":
      return "Review needed"
    case "blocked":
      return "Blocked"
  }
}

function formatEvidence(evidence: AuditSummary["evidence"]) {
  const bits = [
    evidence.diff_present ? `${evidence.sessions_with_diffs} session diff${evidence.sessions_with_diffs === 1 ? "" : "s"}` : "no session diffs",
    evidence.artifacts_present ? `${evidence.artifact_count} retained artifact${evidence.artifact_count === 1 ? "" : "s"}` : "no retained artifacts",
  ]
  return bits.join(", ")
}

function latestActivityTimestamp(input: {
  events: AuditEventRow[]
  artifacts: Array<{ created_at?: number }>
  sessionDiffs: Array<{ updated_at: number }>
}) {
  const timestamps = [
    ...input.events.map((row) => row.created_at),
    ...input.artifacts.map((row) => row.created_at).filter((value): value is number => typeof value === "number"),
    ...input.sessionDiffs.map((row) => row.updated_at),
  ]
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined
}

const PermissionAwareApprovals = {
  async list(sessionID?: string) {
    const { PermissionNext } = await import("../../governance/next")
    const pending = await PermissionNext.list()
    return pending.filter((item) => !sessionID || item.sessionID === sessionID)
  },
}
