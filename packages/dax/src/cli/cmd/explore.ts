import type { Argv } from "yargs"
import path from "path"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { exploreRepository, renderExploreResult } from "../../explore/repo-explore"

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
    const target = path.resolve(process.cwd(), String(args.path ?? "."))
    await bootstrap(target, async () => {
      const result = await exploreRepository(target)

      if (args.format === "json") {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(renderExploreResult(result, { eli12: Boolean(args.eli12) }))
    })
  },
})
