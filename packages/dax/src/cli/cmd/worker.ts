import type { Argv } from "yargs"
import path from "path"
import { EOL } from "os"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { RunGateway } from "../../server/run-gateway"
import { ExternalWorkerId } from "../../worker/worker-adapter"

/**
 * dax worker run <claude|codex|gemini> -- <task>
 *
 * The BYOA entry point (docs/dax/byoa-strategy.md): govern an external
 * coding agent as a capability worker. DAX owns the checkout, the diff,
 * the approval gate, and the evidence; the agent is the engine.
 */
export const WorkerCommand = cmd({
  command: "worker",
  describe: "govern external coding agents as capability workers",
  builder: (yargs: Argv) =>
    yargs
      .command(
        "run <agent> [task..]",
        "run an external agent inside a governed DAX run",
        (y: Argv) =>
          y
            .positional("agent", {
              describe: "external agent to govern",
              choices: ExternalWorkerId.options,
              type: "string",
              demandOption: true,
            })
            .positional("task", {
              describe: "task for the worker (everything after the agent name or --)",
              type: "string",
              array: true,
            })
            .option("repo", {
              describe: "repository path (defaults to current directory)",
              type: "string",
            }),
        async (args) => {
          await bootstrap(process.cwd(), async () => {
            const agent = ExternalWorkerId.parse(args.agent)
            const taskParts = [...((args.task as string[]) ?? []), ...((args["--"] as string[]) ?? [])]
            const task = taskParts.join(" ").trim()
            if (!task) {
              UI.error("a task is required: dax worker run claude -- \"add tests for src/math.ts\"")
              process.exitCode = 1
              return
            }
            const repoPath = path.resolve((args.repo as string) ?? process.cwd())

            UI.println(`Governed worker run: ${agent}`)
            UI.println(`Repo: ${repoPath}`)
            UI.println(`Task: ${task}${EOL}`)

            const created = await RunGateway.createRun({
              intent: {
                input: task,
                kind: "workflow_step",
                repoPath,
              },
              workflowHint: "worker_run",
              personaPreset: {
                personaId: "governed-worker",
                providerHint: `worker:${agent}`,
              },
              metadata: {
                source: "cli",
                initiatedBy: "dax-worker-run",
                targeting: { mode: "explicit_repo_path", repoPath },
              },
            })

            if (created.workflowClass !== "worker_run") {
              UI.error(
                `run ${created.runId} did not resolve to worker_run (got ${created.workflowClass ?? "unknown"}); ${
                  created.warnings?.join("; ") ?? "no warnings"
                }`,
              )
              process.exitCode = 1
              return
            }

            UI.println(`Run created: ${created.runId} (worker_run)`)
            UI.println("The worker executes in a disposable checkout; DAX computes the diff.")

            // Poll until the run reaches the approval gate or a terminal state.
            const deadline = Date.now() + 20 * 60 * 1000
            for (;;) {
              const snapshot = await RunGateway.getSnapshot(created.runId)
              if (snapshot.status === "waiting_approval" || snapshot.pendingApprovalCount > 0) {
                const approvals = await RunGateway.getApprovals(created.runId)
                const approval = approvals.find((item) => item.status === "pending")
                UI.println(`${EOL}Kernel diff is ready for review.`)
                if (approval) {
                  UI.println(
                    `Approve with: dax approvals resolve ${approval.approvalId} --run ${created.runId} --decision approve`,
                  )
                  UI.println(
                    `Deny with:    dax approvals resolve ${approval.approvalId} --run ${created.runId} --decision deny`,
                  )
                } else {
                  UI.println(`List approvals: dax approvals --session ${created.runId}`)
                }
                UI.println(`Inspect the run: dax session show ${created.runId}`)
                return
              }
              if (["completed", "failed", "cancelled"].includes(snapshot.status)) {
                const reason = snapshot.terminalReason ? ` (${snapshot.terminalReason})` : ""
                UI.println(`${EOL}Run ${snapshot.status}${reason}.`)
                if (snapshot.status !== "completed") process.exitCode = 1
                return
              }
              if (Date.now() > deadline) {
                UI.error(`timed out waiting for run ${created.runId}; check dax session show ${created.runId}`)
                process.exitCode = 1
                return
              }
              await Bun.sleep(1000)
            }
          })
        },
      )
      .demandCommand(1),
  handler: async () => {},
})
