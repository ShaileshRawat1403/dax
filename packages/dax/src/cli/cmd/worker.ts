import type { Argv } from "yargs"
import path from "path"
import { EOL } from "os"
import readline from "readline"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { RunGateway } from "../../server/run-gateway"
import { ExternalWorkerId } from "../../worker/worker-adapter"

type FieldSource = "operator-authored" | "inferred"

/** Determine final provenance after card interaction. */
function resolveFieldProvenance(
  source: FieldSource,
  cardShown: boolean,
  cardAccepted: boolean,
): "operator-authored" | "operator-confirmed" | "inferred-unreviewed" {
  if (source === "operator-authored") return "operator-authored"
  if (cardShown && cardAccepted) return "operator-confirmed"
  return "inferred-unreviewed"
}

/** Compact pre-run summary shown before creating the governed run. */
export function renderVetoCard(opts: {
  agent: string
  task: string
  riskLevel: string
  writeScope: string[]
  forbiddenPaths: string[]
  verification: string[]
  sources: {
    writeScope: FieldSource
    forbiddenPaths: FieldSource
    verification: FieldSource
  }
}): string {
  const sep = "─".repeat(60)
  const lines: string[] = [
    sep,
    `Agent:        ${opts.agent}`,
    `Task:         ${opts.task.length > 72 ? opts.task.slice(0, 72) + "…" : opts.task}`,
    `Risk:         ${opts.riskLevel}`,
  ]
  if (opts.writeScope.length > 0)
    lines.push(`Write scope:  ${opts.writeScope.join(", ")}  [${opts.sources.writeScope}]`)
  if (opts.forbiddenPaths.length > 0)
    lines.push(`Forbidden:    ${opts.forbiddenPaths.join(", ")}  [${opts.sources.forbiddenPaths}]`)
  if (opts.verification.length > 0)
    lines.push(`Verify:       ${opts.verification.join(", ")}  [${opts.sources.verification}]`)
  lines.push(sep, "Press Enter to start the run, Ctrl-C to abort.")
  return lines.join(EOL)
}

/** Resolves true on Enter/any key, false on Ctrl-C. */
async function waitForConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question("", () => {
      rl.close()
      resolve(true)
    })
    rl.on("SIGINT", () => {
      rl.close()
      resolve(false)
    })
  })
}

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
            })
            .option("write-scope", {
              describe: "glob patterns the worker may write to (overrides inferred scope)",
              type: "string",
              array: true,
            })
            .option("forbid", {
              describe: "paths or globs the worker must not touch",
              type: "string",
              array: true,
            })
            .option("verify", {
              describe: "validation commands DAX runs to verify the diff",
              type: "string",
              array: true,
            })
            .option("yes", {
              alias: "y",
              describe: "skip the pre-run confirmation card (for scripting)",
              type: "boolean",
              default: false,
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

            // Infer scope from the task via refineIntent (LLM-backed, falls back gracefully).
            // CLI flags always win; refineIntent fills the gap when none are provided.
            const cliWriteScope: string[] = (args["write-scope"] as string[] | undefined) ?? []
            const cliForbiddenPaths: string[] = (args.forbid as string[] | undefined) ?? []
            const cliVerification: string[] = (args.verify as string[] | undefined) ?? []
            const hasCliConstraints = cliWriteScope.length > 0 || cliForbiddenPaths.length > 0 || cliVerification.length > 0

            let inferredWriteScope: string[] = []
            let inferredForbiddenPaths: string[] = []
            let inferredVerification: string[] = []
            let inferredRiskLevel: string = "medium"

            try {
              const { refineIntent } = await import("../../intent/interpret")
              const refined = await refineIntent(task, { cwd: repoPath })
              inferredWriteScope = refined?.likelyWrites ?? []
              inferredForbiddenPaths = refined?.repoImpact?.avoidAreas ?? []
              inferredVerification = refined?.validationCommands ?? []
              inferredRiskLevel = refined?.riskLevel ?? "medium"
            } catch {
              // Non-fatal — empty scope is safe; kernel diff and approval gate remain the authority.
            }

            const writeScope = cliWriteScope.length > 0 ? cliWriteScope : inferredWriteScope
            const forbiddenPaths = cliForbiddenPaths.length > 0 ? cliForbiddenPaths : inferredForbiddenPaths
            const verification = cliVerification.length > 0 ? cliVerification : inferredVerification

            const sources = {
              writeScope: (cliWriteScope.length > 0 ? "operator-authored" : "inferred") as FieldSource,
              forbiddenPaths: (cliForbiddenPaths.length > 0 ? "operator-authored" : "inferred") as FieldSource,
              verification: (cliVerification.length > 0 ? "operator-authored" : "inferred") as FieldSource,
            }

            // Veto card: compact pre-run summary. --yes skips for scripting.
            // Pressing Enter upgrades inferred → operator-confirmed in the evidence record.
            // --yes sets inferred → inferred-unreviewed (operator never saw the scope).
            let cardAccepted = false
            if (!args.yes) {
              const card = renderVetoCard({
                agent, task, riskLevel: inferredRiskLevel,
                writeScope, forbiddenPaths, verification, sources,
              })
              UI.println(card)
              cardAccepted = await waitForConfirmation()
              if (!cardAccepted) {
                UI.println("Aborted.")
                process.exitCode = 1
                return
              }
            }

            const provenance = {
              writeScope: resolveFieldProvenance(sources.writeScope, !args.yes, cardAccepted),
              forbiddenPaths: resolveFieldProvenance(sources.forbiddenPaths, !args.yes, cardAccepted),
              verification: resolveFieldProvenance(sources.verification, !args.yes, cardAccepted),
            }

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
              // Always send all three arrays so what the operator saw on the card is exactly
              // what binds — explicit [] is authoritative, not a fallback trigger.
              workerConstraints: { writeScope, forbiddenPaths, verification, provenance },
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
