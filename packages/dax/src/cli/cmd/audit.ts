import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { RAOLedger } from "../../rao"
import { Instance } from "../../project/instance"
import { Audit } from "../../audit"
import { PM } from "../../pm"
import { Config } from "../../config/config"

export const AuditCommand = cmd({
  command: "audit",
  describe: "run SDLC audit checks or inspect RAO audit ledger",
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
      })
      .demandCommand(0),
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
