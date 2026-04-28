import type { Argv } from "yargs"
import fs from "node:fs/promises"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Config } from "../../config/config"
import { Permission } from "../../governance"
import { RookBridge } from "../../governance/rook-bridge-types"
import { RookEvaluate } from "../../governance/evaluate"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function readInput(source: string | undefined): Promise<string> {
  if (!source || source === "-") return readStdin()
  return fs.readFile(source, "utf8")
}

export const GovernanceCommand = cmd({
  command: "governance",
  describe: "governance evaluation surface for external hosts",
  builder: (yargs: Argv) =>
    yargs.command({
      command: "evaluate",
      describe: "evaluate a ProposedAction against the current policy",
      builder: (y) =>
        y.option("json", {
          type: "string",
          describe:
            "path to a ProposedAction JSON file; omit to read from stdin",
        }),
      handler: async (args) => {
        const raw = await readInput(args.json as string | undefined)
        const parsed = JSON.parse(raw)
        const action = RookBridge.ProposedAction.parse(parsed)

        await bootstrap(process.cwd(), async () => {
          const cfg = await Config.get()
          const ruleset = Permission.fromConfig(cfg.permission ?? {})
          const decision = RookEvaluate.evaluate(action, ruleset)
          process.stdout.write(JSON.stringify(decision) + "\n")
        })
      },
    }),
  handler: () => {
    /* parent — yargs will show help when no subcommand is given */
  },
})
