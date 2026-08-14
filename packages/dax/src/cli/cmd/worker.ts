import type { Argv } from "yargs"
import path from "path"
import { EOL } from "os"
import readline from "readline"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { RunGateway } from "../../server/run-gateway"
import { ExternalWorkerId } from "../../worker/worker-adapter"
import { buildEgressAllowlist } from "../../worker/egress-allowlist"
import { detectChecks } from "../../sdlc/check-catalog"
import type { CheckDefinition } from "../../sdlc/check-types"
import { isWhitelistedVerificationCommand } from "../../tool/shell-whitelist"
import { checkWorkerSandbox } from "../../worker/worker-sandbox"
import * as prompts from "@clack/prompts"

export type FieldSource = "operator-authored" | "inferred"

function checkCommand(check: CheckDefinition): string {
  return [check.command, ...check.args].join(" ")
}

/**
 * Resolve verification before the veto card so the operator sees the exact
 * DAX-owned commands that will run. CLI intent wins, then safe intent
 * inference, then repository-native check detection.
 */
export function resolveWorkerVerificationCommands(input: {
  cli: string[]
  inferred: string[]
  detected: CheckDefinition[]
}): string[] {
  if (input.cli.length > 0) return input.cli

  const inferred = input.inferred.filter(isWhitelistedVerificationCommand)
  if (inferred.length > 0) return inferred

  return input.detected.map(checkCommand).filter(isWhitelistedVerificationCommand)
}

/** Determine final provenance after card interaction.
 *  authorship (CLI flag) beats confirmation (card + Enter) beats unreviewed (--yes). */
export function resolveFieldProvenance(
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
  isolation: string
  egress: { mode: "filtered" | "unconfined"; hosts: string[] }
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
    `Isolation:    ${opts.isolation}`,
    `Egress:       ${
      opts.egress.mode === "filtered"
        ? `${opts.egress.hosts.join(", ")}  [allowlist]`
        : "unconfined  [--no-egress-filter]"
    }`,
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
            .option("egress-filter", {
              describe:
                "confine worker network egress to the provider host allowlist (use --no-egress-filter to opt out)",
              type: "boolean",
              default: true,
            })
            .option("allow-egress", {
              describe: "additional hosts the worker may reach beyond the provider defaults",
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
            const sandbox = checkWorkerSandbox()
            if (!sandbox.available) {
              UI.error(sandbox.reason)
              UI.println(sandbox.remedy)
              UI.println("Governed workers fail closed when OS isolation is unavailable.")
              process.exitCode = 1
              return
            }

            // Infer scope from the task via refineIntent (LLM-backed, falls back gracefully).
            // CLI flags always win; refineIntent fills the gap when none are provided.
            const cliWriteScope: string[] = (args["write-scope"] as string[] | undefined) ?? []
            const cliForbiddenPaths: string[] = (args.forbid as string[] | undefined) ?? []
            const cliVerification: string[] = (args.verify as string[] | undefined) ?? []

            const unsafeVerification = cliVerification.find((command) => !isWhitelistedVerificationCommand(command))
            if (unsafeVerification) {
              UI.error(`Verification command is not approved by DAX: ${unsafeVerification}`)
              process.exitCode = 1
              return
            }

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
            const verification = resolveWorkerVerificationCommands({
              cli: cliVerification,
              inferred: inferredVerification,
              detected: detectChecks(repoPath),
            })

            if (verification.length === 0) {
              UI.error("No safe verification command was supplied or detected. Add --verify, for example: --verify \"bun test\".")
              process.exitCode = 1
              return
            }

            const sources = {
              writeScope: (cliWriteScope.length > 0 ? "operator-authored" : "inferred") as FieldSource,
              forbiddenPaths: (cliForbiddenPaths.length > 0 ? "operator-authored" : "inferred") as FieldSource,
              verification: (cliVerification.length > 0 ? "operator-authored" : "inferred") as FieldSource,
            }

            // Egress confinement: on by default, narrowed to the provider host
            // allowlist. The operator sees the exact hosts on the card and can
            // widen (--allow-egress) or opt out (--no-egress-filter).
            const egressFilter = (args["egress-filter"] as boolean | undefined) ?? true
            const allowEgress = (args["allow-egress"] as string[] | undefined) ?? []
            const egressForCard = {
              mode: (egressFilter ? "filtered" : "unconfined") as "filtered" | "unconfined",
              hosts: egressFilter
                ? [...buildEgressAllowlist({ workerId: agent, hostEnv: process.env, allowHosts: allowEgress })]
                : [],
            }

            // Veto card: compact pre-run summary. --yes skips for scripting.
            // Pressing Enter upgrades inferred → operator-confirmed in the evidence record.
            // --yes sets inferred → inferred-unreviewed (operator never saw the scope).
            let cardAccepted = false
            if (!args.yes) {
              const card = renderVetoCard({
                agent, task, riskLevel: inferredRiskLevel,
                writeScope, forbiddenPaths, verification, isolation: sandbox.summary,
                egress: egressForCard, sources,
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
            UI.println(`Isolation: ${sandbox.summary}${EOL}`)

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
              workerConstraints: {
                writeScope,
                forbiddenPaths,
                verification,
                provenance,
                egress: { filter: egressFilter, allowHosts: allowEgress },
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
            const spinner = prompts.spinner()
            let progress = "Starting governed worker..."
            spinner.start(progress)
            for (;;) {
              const snapshot = await RunGateway.getSnapshot(created.runId)
              const nextProgress = snapshot.currentStep?.title ?? `Run ${snapshot.status.replaceAll("_", " ")}`
              if (nextProgress !== progress && snapshot.status !== "waiting_approval") {
                spinner.stop(progress)
                progress = nextProgress
                spinner.start(progress)
              }
              if (snapshot.status === "waiting_approval" || snapshot.pendingApprovalCount > 0) {
                spinner.stop("Worker finished and DAX verification completed")
                const approvals = await RunGateway.getApprovals(created.runId)
                const approval = approvals.find((item) => item.status === "pending")
                UI.println(`${EOL}Kernel diff is ready for review.`)
                UI.println("DAX verification receipts were recorded before this review gate.")
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
                spinner.stop(`Run ${snapshot.status}${reason}`, snapshot.status === "completed" ? 0 : 1)
                UI.println(`${EOL}Run ${snapshot.status}${reason}.`)
                if (snapshot.status !== "completed") process.exitCode = 1
                return
              }
              if (Date.now() > deadline) {
                spinner.stop("Run is still active", 1)
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
