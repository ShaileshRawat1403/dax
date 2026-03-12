import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { buildRunOptions, executeRun } from "./run"

export function normalizeDocsArgs<T extends { message?: string[]; strict?: boolean }>(args: T): T {
  if (!args.strict) return args
  return {
    ...args,
    message: [...(args.message ?? []), "--strict"],
  }
}

export const DocsCommand = cmd({
  command: "docs [message..]",
  describe: "run DAX documentation workflows",
  builder: (yargs: Argv) =>
    buildRunOptions(yargs)
      .option("command", {
        describe: "ignored for dax docs; docs mode is always used",
        type: "string",
        hidden: true,
      })
      .option("strict", {
        describe: "run docs QA in strict mode",
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    await executeRun(normalizeDocsArgs(args as any), { defaultCommand: "docs" })
  },
})
