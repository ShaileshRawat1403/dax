import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { buildRunOptions, executeRun } from "./run"

export const DocsCommand = cmd({
  command: "docs [message..]",
  describe: "run DAX documentation workflows",
  builder: (yargs: Argv) =>
    buildRunOptions(yargs).option("command", {
      describe: "ignored for dax docs; docs mode is always used",
      type: "string",
      hidden: true,
    }),
  handler: async (args) => {
    await executeRun(args as any, { defaultCommand: "docs" })
  },
})
