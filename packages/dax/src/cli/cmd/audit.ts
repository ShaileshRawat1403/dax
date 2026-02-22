import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { RAOLedger } from "../../rao"
import { Instance } from "../../project/instance"

export const AuditCommand = cmd({
  command: "audit",
  describe: "show RAO audit ledger events",
  builder: (yargs: Argv) =>
    yargs
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
        const payload = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload)
        console.log(`${ts} ${row.event_type} ${payload}`)
      }
    })
  },
})
