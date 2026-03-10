import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { collectSessionVerification, formatSessionVerification } from "../../trust/verify-session"

export const VerifyCommand = cmd({
  command: "verify <session-id>",
  describe: "judge whether a session's evidence and governance signals are strong enough to trust",
  builder: (yargs: Argv) =>
    yargs
      .positional("session-id", {
        describe: "session id to verify",
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
      const summary = await collectSessionVerification(sessionID)

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatSessionVerification(summary))
    })
  },
})
