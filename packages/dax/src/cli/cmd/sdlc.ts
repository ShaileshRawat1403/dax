import { resolve } from "node:path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { formatSdlcVerification, verifySdlc } from "@/sdlc"

export const SdlcCommand = cmd({
  command: "sdlc <action>",
  describe: "inspect and verify SDLC readiness evidence",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "SDLC action to run",
        type: "string",
        choices: ["verify"],
      })
      .option("repo", {
        describe: "repository root to verify",
        type: "string",
        default: process.cwd(),
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("native", {
        describe: "prefer DAX-native verification scripts when available",
        type: "boolean",
        default: false,
      })
      .option("security", {
        describe: "include optional security and secrets checks",
        type: "boolean",
        default: false,
      })
      .option("receipts", {
        describe: "include evidence receipts in JSON output",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const action = String(args.action)
    if (action !== "verify") throw new Error(`Unsupported SDLC action: ${action}`)

    const result = await verifySdlc({
      repoRoot: resolve(String(args.repo)),
      native: args.native === true,
      security: args.security === true,
    })

    if (args.format === "json") {
      console.log(JSON.stringify(args.receipts === true ? result : result.report, null, 2))
      return
    }

    console.log(formatSdlcVerification(result.report))
  },
})
