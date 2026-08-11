import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { listInterruptedRuns, markRunInterrupted } from "@/state/recovery"
import type { RunState } from "@/state/run-state"
import { renderTable } from "@/util/table"
import { Locale } from "@/util/locale"

export type StrandedRunRow = {
  runId: string
  status: string
  updatedAt: number
}

export function toStrandedRunRow(state: RunState): StrandedRunRow {
  return {
    runId: state.runId,
    status: state.status,
    updatedAt: Date.parse(state.updatedAt),
  }
}

export function formatStrandedRunTable(rows: StrandedRunRow[]): string {
  if (rows.length === 0) return "No stranded runs."

  return renderTable(
    [
      { header: "Run ID", minWidth: 16 },
      { header: "Stuck In", minWidth: 12 },
      { header: "Last Updated", minWidth: 16 },
    ],
    rows.map((row) => [row.runId, row.status, Locale.todayTimeOrDateTime(row.updatedAt)]),
  )
}

export const RecoverCommand = cmd({
  command: "recover",
  describe: "list runs whose process died mid-flight and close them out",
  builder: (yargs: Argv) =>
    yargs
      .option("apply", {
        alias: "a",
        describe: "close out stranded runs as failed (defaults to listing only)",
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
      const stranded = await listInterruptedRuns()

      if (!args.apply) {
        const rows = stranded.map(toStrandedRunRow)
        if (args.format === "json") {
          console.log(JSON.stringify(rows, null, 2))
          return
        }
        console.log(formatStrandedRunTable(rows))
        if (rows.length > 0) {
          console.log(`\nRun with --apply to close out ${rows.length} stranded run${rows.length === 1 ? "" : "s"}.`)
        }
        return
      }

      const closed: RunState[] = []
      for (const state of stranded) {
        const result = await markRunInterrupted(state.runId)
        if (result) closed.push(result)
      }

      if (args.format === "json") {
        console.log(JSON.stringify(closed.map(toStrandedRunRow), null, 2))
        return
      }

      if (closed.length === 0) {
        console.log("No stranded runs found.")
        return
      }
      console.log(`Closed out ${closed.length} stranded run${closed.length === 1 ? "" : "s"}:`)
      console.log(formatStrandedRunTable(closed.map(toStrandedRunRow)))
    })
  },
})
