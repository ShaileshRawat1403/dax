import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { runExploreOperator } from "../../explore/operator"

export const ExploreCommand = cmd({
  command: "explore [path]",
  describe: "inspect a repository and return structured execution-oriented understanding",
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        describe: "repository path to inspect",
        type: "string",
        default: ".",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("eli12", {
        describe: "simplify explanations in the rendered report without changing the Explore structure",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const target = String(args.path ?? ".")
    await bootstrap(target, async () => {
      const output = await runExploreOperator({
        baseDir: process.cwd(),
        pathArg: target,
        format: args.format === "json" ? "json" : "table",
        eli12: Boolean(args.eli12),
      })
      console.log(output.rendered)
    })
  },
})
