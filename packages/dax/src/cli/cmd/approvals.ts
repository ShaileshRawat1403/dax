import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { PermissionNext } from "../../governance/next"
import { Locale } from "../../util/locale"
import { EOL } from "os"

type ApprovalRow = {
  id: string
  status: "awaiting_operator_decision"
  session_id: string
  requested_action: string
  reason: string
  created_at: number
}

export const ApprovalsCommand = cmd({
  command: "approvals",
  describe: "inspect pending approvals awaiting operator decision",
  builder: (yargs: Argv) =>
    yargs
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
      const approvals = await PermissionNext.list()
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

export function toApprovalRow(input: PermissionNext.Request): ApprovalRow {
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

  return rows
    .map((row) =>
      [
        `Approval ID: ${row.id}`,
        `Status: Awaiting operator decision`,
        `Requested operation: ${row.requested_action}`,
        `Related session: ${row.session_id}`,
        `Created: ${Locale.todayTimeOrDateTime(row.created_at)}`,
        `Reason: ${row.reason}`,
      ].join(EOL),
    )
    .join(`${EOL}${"─".repeat(72)}${EOL}`)
}
