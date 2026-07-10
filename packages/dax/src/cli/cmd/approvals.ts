import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Permission } from "../../governance"
import { Locale } from "../../util/locale"
import { EOL } from "os"
import { Session } from "../../session"
import { renderTable } from "@/util/table"
import { RunGateway } from "../../server/run-gateway"

type ApprovalRow = {
  id: string
  status: "awaiting_operator_decision"
  session_id: string
  requested_action: string
  reason: string
  created_at: number
}

type ApprovalClassification = "active_run" | "terminal_run" | "orphaned"

type PruneCandidate = {
  approval: Permission.Request
  classification: ApprovalClassification
  ageMs: number
  ageLabel: string
  sessionStatus?: string
}

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"]
const ACTIVE_STATUSES = ["created", "queued", "running", "waiting_approval"]

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`Invalid duration format: ${duration}`)
  const value = parseInt(match[1], 10)
  switch (match[2]) {
    case "m":
      return value * 60000
    case "h":
      return value * 3600000
    case "d":
      return value * 86400000
    case "w":
      return value * 7 * 86400000
    default:
      throw new Error(`Unknown unit: ${match[2]}`)
  }
}

async function classifyApproval(
  approval: Permission.Request,
): Promise<{ classification: ApprovalClassification; sessionStatus?: string }> {
  const sessionId = approval.sessionID

  try {
    const session = await Session.get(sessionId)

    try {
      const snapshot = await RunGateway.getSnapshot(sessionId)
      const status = snapshot.status

      if (ACTIVE_STATUSES.includes(status)) {
        return { classification: "active_run", sessionStatus: status }
      }
      return { classification: "terminal_run", sessionStatus: status }
    } catch {
      return { classification: "terminal_run", sessionStatus: "snapshot_not_found" }
    }
  } catch {
    return { classification: "orphaned", sessionStatus: "session_not_found" }
  }
}

export function toApprovalRow(input: Permission.Request): ApprovalRow {
  const patterns = input.patterns.length > 0 ? input.patterns.join(", ") : "*"
  const reason = (() => {
    if (typeof input.metadata?.description === "string" && input.metadata.description.trim()) {
      return input.metadata.description.trim()
    }
    if (input.tool?.callID) return `tool call ${input.tool.callID}`
    return "approval required before execution"
  })()

  return {
    id: input.id,
    status: "awaiting_operator_decision",
    session_id: input.sessionID,
    requested_action: `${input.permission} ${patterns}`.trim(),
    reason,
    created_at: input.createdAt,
  }
}

export function formatApprovalTable(rows: ApprovalRow[]): string {
  if (rows.length === 0) return "No pending approvals."

  return renderTable(
    [
      { header: "Approval ID", minWidth: 16 },
      { header: "Session", minWidth: 16 },
      { header: "Operation", minWidth: 20, maxWidth: 40 },
      { header: "Reason", minWidth: 20, maxWidth: 40 },
      { header: "Created", minWidth: 16 },
    ],
    rows.map((row) => [
      row.id,
      row.session_id,
      row.requested_action,
      row.reason,
      Locale.todayTimeOrDateTime(row.created_at),
    ]),
  )
}

export const ApprovalsResolveCommand = cmd({
  command: "resolve <approval-id>",
  describe: "approve or deny a pending run approval",
  builder: (yargs: Argv) =>
    yargs
      .positional("approval-id", {
        describe: "approval id to resolve",
        type: "string",
        demandOption: true,
      })
      .option("run", {
        describe: "run/session id that owns the approval",
        type: "string",
        demandOption: true,
      })
      .option("decision", {
        describe: "operator decision",
        type: "string",
        choices: ["approve", "deny"],
        demandOption: true,
      })
      .option("actor", {
        describe: "operator actor id recorded in the approval resolution",
        type: "string",
        default: "cli-operator",
      })
      .option("comment", {
        describe: "optional decision comment",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const approvalId = String(args.approvalId)
      const runId = String(args.run)
      const decision = args.decision === "deny" ? "deny" : "approve"
      const resolved = await RunGateway.resolveApproval(runId, approvalId, {
        decision,
        actorId: String(args.actor ?? "cli-operator"),
        source: "dax",
        comment: typeof args.comment === "string" ? args.comment : undefined,
      })

      console.log(
        [
          `Approval ${resolved.approvalId} ${resolved.status}.`,
          `Decision: ${resolved.resolution.decision}`,
          `Run: ${runId}`,
        ].join(EOL),
      )
    })
  },
})

export const ApprovalsPruneCommand = cmd({
  command: "prune",
  describe: "prune stale pending approvals from orphaned or completed runs",
  builder: (yargs: Argv) =>
    yargs
      .option("older-than", {
        alias: "o",
        describe: "prune approvals older than duration (e.g., 7d, 24h, 30m)",
        type: "string",
        default: "7d",
      })
      .option("apply", {
        alias: "a",
        describe: "actually delete prunable approvals (defaults to dry-run)",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const thresholdMs = parseDuration(args.olderThan)
      const now = Date.now()

      const approvals = await Permission.list()
      const candidates: PruneCandidate[] = []

      for (const approval of approvals) {
        const ageMs = now - approval.createdAt
        const { classification, sessionStatus } = await classifyApproval(approval)
        candidates.push({
          approval,
          classification,
          ageMs,
          ageLabel: formatAge(ageMs),
          sessionStatus,
        })
      }

      const activeApprovals = candidates.filter((c) => c.classification === "active_run")
      const terminalApprovals = candidates.filter((c) => c.classification === "terminal_run" && c.ageMs > thresholdMs)
      const orphanedApprovals = candidates.filter((c) => c.classification === "orphaned" && c.ageMs > thresholdMs)
      const expiredTerminal = candidates.filter((c) => c.classification === "terminal_run" && c.ageMs <= thresholdMs)
      const expiredOrphaned = candidates.filter((c) => c.classification === "orphaned" && c.ageMs <= thresholdMs)

      const prunable = [...terminalApprovals, ...orphanedApprovals]
      const kept = [...activeApprovals, ...expiredTerminal, ...expiredOrphaned]

      const summary = {
        total: candidates.length,
        activeRun: activeApprovals.length,
        terminalPrunable: terminalApprovals.length,
        orphanedPrunable: orphanedApprovals.length,
        terminalSkipped: expiredTerminal.length,
        orphanedSkipped: expiredOrphaned.length,
        willDelete: prunable.length,
        willKeep: kept.length,
        threshold: args.olderThan,
        mode: args.apply ? "apply" : "dry-run",
      }

      if (args.format === "json") {
        console.log(
          JSON.stringify(
            {
              summary,
              prunable: prunable.map((c) => ({
                id: c.approval.id,
                sessionId: c.approval.sessionID,
                classification: c.classification,
                age: c.ageLabel,
                permission: c.approval.permission,
                reason: c.approval.metadata?.description ?? "N/A",
              })),
            },
            null,
            2,
          ),
        )
        return
      }

      console.log("DAX Approval Prune")
      console.log("═".repeat(72))
      console.log(`Total pending approvals: ${summary.total}`)
      console.log(`Threshold: older than ${summary.threshold}`)
      console.log(`Mode: ${summary.mode === "apply" ? "WILL DELETE" : "DRY-RUN (use --apply to delete)"}`)
      console.log("")
      console.log("Classification Summary:")
      console.log(`  Active run approvals (protected):  ${String(summary.activeRun).padStart(4)} kept`)
      console.log(`  Terminal run (too new):            ${String(summary.terminalSkipped).padStart(4)} kept`)
      console.log(
        `  Terminal run (will prune):         ${String(summary.terminalPrunable).padStart(4)} ${args.apply ? "deleted" : "prunable"}`,
      )
      console.log(`  Orphaned (too new):               ${String(summary.orphanedSkipped).padStart(4)} kept`)
      console.log(
        `  Orphaned (will prune):             ${String(summary.orphanedPrunable).padStart(4)} ${args.apply ? "deleted" : "prunable"}`,
      )
      console.log("")
      console.log(`Will ${args.apply ? "delete" : "show"} ${summary.willDelete} approvals, keep ${summary.willKeep}`)
      console.log("")

      if (prunable.length > 0) {
        console.log("Prunable Approvals:")
        console.log("─".repeat(72))
        for (const candidate of prunable) {
          const reason =
            typeof candidate.approval.metadata?.description === "string"
              ? candidate.approval.metadata.description.slice(0, 50)
              : "approval required"
          console.log(
            [
              `${candidate.classification === "orphaned" ? "⚠" : "○"} ${candidate.approval.id}`,
              `  Session: ${candidate.approval.sessionID}`,
              `  Age: ${candidate.ageLabel} (status: ${candidate.sessionStatus})`,
              `  Permission: ${candidate.approval.permission}`,
              `  Reason: ${reason}`,
            ].join(EOL),
          )
          console.log("")
        }
      }

      if (!args.apply && prunable.length > 0) {
        console.log(`Run with --apply to delete ${prunable.length} stale approvals.`)
      }

      if (args.apply && prunable.length > 0) {
        let deleted = 0
        for (const candidate of prunable) {
          await Permission.reply({
            requestID: candidate.approval.id,
            reply: "reject",
            message: `Auto-pruned: stale approval from ${candidate.classification} run`,
          })
          deleted++
        }
        console.log(`Deleted ${deleted} stale approvals.`)
      }

      if (candidates.length === 0) {
        console.log("No pending approvals found.")
      }
    })
  },
})

export const ApprovalsCommand = cmd({
  command: "approvals",
  describe: "inspect pending approvals awaiting operator decision",
  builder: (yargs: Argv) =>
    yargs
      .command(ApprovalsResolveCommand)
      .command(ApprovalsPruneCommand)
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("session", {
        describe: "filter approvals for a related session id",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const approvals = await Permission.list()
      const rows = approvals
        .filter((item) => !args.session || item.sessionID === args.session)
        .map(toApprovalRow)
        .sort((a, b) => a.created_at - b.created_at)

      if (args.format === "json") {
        console.log(JSON.stringify(rows, null, 2))
        return
      }

      console.log(formatApprovalTable(rows))
    })
  },
})
