import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import path from "path"
import { interpretIntent } from "../../intent/interpret"
import { createPlan } from "../../planner/planner"
import { runGraph } from "../../execution/run-graph"
import { OperatorRouter } from "../../operators/router"
import { ExploreOperator } from "../../operators/explore"
import { renderExploreResult, type RepoExploreResult } from "../../explore/repo-explore"

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
      const resolvedTarget = path.resolve(process.cwd(), target)

      // 1. Intent Interpreter
      const intent = await interpretIntent(`explore ${target}`, { cwd: resolvedTarget })
      
      // 2. Planner
      const graph = await createPlan(intent, {})
      
      // 3. Setup router and operator
      const router = new OperatorRouter()
      router.register(new ExploreOperator())
      
      // 4. Run the Agent Graph
      const result = await runGraph(graph, { cwd: resolvedTarget, sessionId: "cli-explore" }, router)
      
      if (!result.success) {
        console.error("Explore execution failed:", result.failedTasks)
        for (const taskId of result.failedTasks) {
          const task = graph.tasks.get(taskId)
          if (task?.error) {
            console.error(`Task ${taskId} error:`, task.error)
          }
        }
        process.exit(1)
      }

      // 5. Output
      const reportTask = graph.tasks.get('task_generate_report')
      const exploreResult = reportTask?.result as RepoExploreResult

      if (args.format === "json") {
        console.log(JSON.stringify(exploreResult, null, 2))
      } else {
        console.log(renderExploreResult(exploreResult, { eli12: Boolean(args.eli12) }))
      }
    })
  },
})
