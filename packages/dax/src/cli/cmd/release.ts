import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { collectSessionReleaseCheck, formatSessionReleaseCheck } from "../../release/check-session-release"

export const ReleaseCommand = cmd({
  command: "release",
  describe: "evaluate whether a session is operationally ready for handoff or shipping",
  builder: (yargs: Argv) =>
    yargs.command(ReleaseCheckCommand).demandCommand(),
  async handler() {},
})

export const ReleaseCheckCommand = cmd({
  command: "check <session-id>",
  describe: "judge whether a session is ready for review, handoff, or release",
  builder: (yargs: Argv) =>
    yargs
      .positional("session-id", {
        describe: "session id to evaluate",
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
      const summary = await collectSessionReleaseCheck(sessionID)

      if (args.format === "json") {
        console.log(JSON.stringify(summary, null, 2))
        return
      }

      console.log(formatSessionReleaseCheck(summary))
    })
  },
})
