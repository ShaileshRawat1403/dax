import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import path from "path"
import fs from "fs"
import { runGraph } from "../../execution/run-graph"
import { createInitializedRouter } from "../../operators/router"
import { buildWorkflowGraph, WORKFLOWS, type WorkflowId } from "../../workflows/builtin-workflows"
import { SessionStateManager } from "../../session/update-state"
import type { SessionState } from "../../session/state-types"
import { ARTIFACT_SCHEMA_VERSION } from "../../workflows/artifact-schemas"

function createInitialSessionState(sessionId: string, cwd: string, workflowId: string): SessionState {
  return {
    id: sessionId,
    status: "active",
    workflowId,
    workspace: {
      cwd: cwd,
    },
    findings: [],
    hypotheses: [],
    openQuestions: [],
    risks: [],
    nextActions: [],
    completedSteps: [],
    emittedArtifacts: [],
    trustState: {
      score: 0.5,
      posture: "neutral",
      signals: [],
      lastUpdated: new Date().toISOString(),
    },
    approvalState: {
      pending: [],
      granted: [],
      denied: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function getSessionDir(sessionId: string): string {
  return path.resolve(process.cwd(), ".dax/sessions", sessionId)
}

function loadSessionSnapshot(sessionId: string): any {
  const sessionDir = getSessionDir(sessionId)
  const snapshotPath = path.join(sessionDir, "session-snapshot.json")
  if (fs.existsSync(snapshotPath)) {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"))
  }
  return null
}

function generateWorkflowSummary(state: SessionState, workflowId: string): any {
  const releaseArtifact = state.emittedArtifacts.find((a) => a.type === "release_report")
  const verificationArtifact = state.emittedArtifacts.find((a) => a.type === "verification_report")

  let releaseStatus = "unknown"
  let blockers: string[] = []
  let warnings: string[] = []

  if (releaseArtifact) {
    releaseStatus = releaseArtifact.description?.includes("BLOCKED")
      ? "blocked"
      : releaseArtifact.description?.includes("needs")
        ? "needs-work"
        : "ready"
    blockers = state.findings.filter((f) => f.severity === "critical").map((f) => f.title)
    warnings = state.risks.map((r) => r.description || "")
  }

  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    workflow: workflowId,
    session_id: state.id,
    target_repo: state.workspace.cwd,
    status: state.status,
    trust_score: state.trustState.score,
    release_status: releaseStatus,
    trust_summary: {
      score: state.trustState.score,
      posture: state.trustState.posture,
      signals_count: state.trustState.signals.length,
    },
    governance_result: {
      findings_count: state.findings.length,
      risks_count: state.risks.length,
      blockers: blockers,
      warnings: warnings,
    },
    emitted_artifacts: state.emittedArtifacts.map((a) => ({
      type: a.type,
      path: a.path,
      produced_by: a.producedBy,
    })),
    recommended_next_steps: state.nextActions.filter((a) => a.status === "pending").map((a) => a.description),
    completed_at: state.completedAt || new Date().toISOString(),
  }
}

export const WorkflowCommand = cmd({
  command: "workflow <command>",
  describe: "Manage DAX workflows",
  builder: (yargs: Argv) => {
    return yargs
      .command({
        command: "list",
        describe: "List available workflows",
        handler: async () => {
          console.log("Available workflows:")
          for (const [id, workflow] of Object.entries(WORKFLOWS)) {
            console.log(`  - ${id}: ${workflow.description}`)
          }
        },
      })
      .command({
        command: "run [workflow] [path]",
        describe: "Run a workflow",
        builder: (yargs: Argv) =>
          yargs
            .positional("workflow", {
              describe: "workflow to run",
              type: "string",
              default: "repo-health",
            })
            .positional("path", {
              describe: "repository path",
              type: "string",
              default: ".",
            })
            .option("resume", {
              describe: "session ID to resume",
              type: "string",
            }),
        handler: async (args) => {
          const target = String(args.path ?? ".").replace(/\0/g, "")
          const resolvedTarget = path.resolve(target)
          const workflowId = (args.workflow as WorkflowId) || "repo-health"

          await bootstrap(resolvedTarget, async () => {
            console.log(`Running workflow: ${workflowId} on ${resolvedTarget}`)

            const graph = buildWorkflowGraph(workflowId)
            const sessionId = args.resume || `workflow-${Date.now()}`
            const initialState = createInitialSessionState(sessionId, resolvedTarget, workflowId)
            const stateManager = new SessionStateManager(initialState)
            stateManager.updateWorkflow(workflowId)

            const router = createInitializedRouter()
            const result = await runGraph(graph, { cwd: resolvedTarget, sessionId }, router, stateManager)

            const state = stateManager.getState()
            state.status = result.success ? "completed" : "failed"
            if (result.blockedTasks.length > 0) {
              state.status = "blocked"
            }
            state.completedAt = new Date().toISOString()

            // Generate and save workflow summary
            const summary = generateWorkflowSummary(state, workflowId)
            const sessionDir = getSessionDir(sessionId)
            if (!fs.existsSync(sessionDir)) {
              fs.mkdirSync(sessionDir, { recursive: true })
            }
            fs.writeFileSync(path.join(sessionDir, "workflow-summary.json"), JSON.stringify(summary, null, 2))

            console.log("\n═══════════════════════════════════════")
            console.log("          WORKFLOW RESULT")
            console.log("═══════════════════════════════════════")
            console.log(`Status: ${result.success ? "✓ COMPLETED" : "✗ FAILED"}`)
            if (result.blockedTasks.length > 0) {
              console.log(`Blocked: ${result.blockedTasks.join(", ")}`)
            }
            console.log(`Session ID: ${sessionId}`)

            console.log("\n─────────── SUMMARY ───────────")
            console.log(`Findings:  ${state.findings.length}`)
            console.log(`Risks:    ${state.risks.length}`)
            console.log(`Artifacts: ${state.emittedArtifacts.length}`)
            console.log(`Trust:    ${Math.round(state.trustState.score * 100)}% (${state.trustState.posture})`)
            console.log(`Release:  ${summary.release_status?.toUpperCase() || "UNKNOWN"}`)
            console.log("───────────────────────────────────")

            if (!result.success) {
              process.exit(1)
            }
          })
        },
      })
      .command({
        command: "inspect <session-id>",
        describe: "Inspect a workflow session",
        builder: (yargs: Argv) =>
          yargs.positional("session-id", {
            describe: "session ID to inspect",
            type: "string",
            demandOption: true,
          }),
        handler: async (args) => {
          const sessionId = args["session-id"] as string
          const snapshot = loadSessionSnapshot(sessionId)

          if (!snapshot) {
            console.error(`Session not found: ${sessionId}`)
            process.exit(1)
          }

          console.log("\n=== Workflow Session Inspection ===")
          console.log(`Session ID: ${snapshot.sessionId}`)
          console.log(`Workflow: ${snapshot.workflowId}`)
          console.log(`Status: ${snapshot.state.status}`)
          console.log(`Created: ${snapshot.state.createdAt}`)
          console.log(`Updated: ${snapshot.state.updatedAt}`)

          console.log("\n--- Trust State ---")
          console.log(`Score: ${Math.round(snapshot.state.trustState.score * 100)}%`)
          console.log(`Posture: ${snapshot.state.trustState.posture}`)

          console.log("\n--- Findings & Risks ---")
          console.log(`Findings: ${snapshot.state.findings.length}`)
          console.log(`Risks: ${snapshot.state.risks.length}`)

          console.log("\n--- Artifacts ---")
          for (const artifact of snapshot.state.emittedArtifacts) {
            console.log(`  - ${artifact.type}: ${artifact.description}`)
          }

          if (snapshot.graphStatus) {
            console.log("\n--- Graph Status ---")
            console.log(`Completed: ${snapshot.graphStatus.completedNodeIds.join(", ") || "none"}`)
            console.log(`Pending: ${snapshot.graphStatus.pendingNodeIds.join(", ") || "none"}`)
            console.log(`Blocked: ${snapshot.graphStatus.blockedNodeIds.join(", ") || "none"}`)
            console.log(`Failed: ${snapshot.graphStatus.failedNodeIds.join(", ") || "none"}`)
          }

          // Try to show workflow summary if exists
          const summaryPath = path.join(getSessionDir(sessionId), "workflow-summary.json")
          if (fs.existsSync(summaryPath)) {
            const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"))
            console.log("\n--- Workflow Summary ---")
            console.log(`Status: ${summary.status}`)
            console.log(`Trust Score: ${Math.round(summary.trust_score * 100)}%`)
            console.log(`Release Status: ${summary.release_status}`)
            console.log(
              `Governance: ${summary.governance_result.findings_count} findings, ${summary.governance_result.risks_count} risks`,
            )
            if (summary.governance_result.blockers && summary.governance_result.blockers.length > 0) {
              console.log(`Blockers: ${summary.governance_result.blockers.join(", ")}`)
            }
            if (summary.governance_result.warnings && summary.governance_result.warnings.length > 0) {
              console.log(`Warnings: ${summary.governance_result.warnings.join(", ")}`)
            }
            if (summary.recommended_next_steps && summary.recommended_next_steps.length > 0) {
              console.log(`Next Steps: ${summary.recommended_next_steps.join(", ")}`)
            }
          }
        },
      })
      .command({
        command: "artifacts <subcommand>",
        describe: "Manage workflow artifacts",
        builder: (yargs: Argv) =>
          yargs
            .command({
              command: "list <session-id>",
              describe: "List artifacts for a workflow session",
              builder: (yargs: Argv) =>
                yargs.positional("session-id", {
                  describe: "session ID",
                  type: "string",
                  demandOption: true,
                }),
              handler: async (args) => {
                const sessionId = args["session-id"] as string
                const snapshot = loadSessionSnapshot(sessionId)

                if (!snapshot) {
                  console.error(`Session not found: ${sessionId}`)
                  process.exit(1)
                }

                const artifacts = snapshot.state?.emittedArtifacts || []
                if (artifacts.length === 0) {
                  console.log("No artifacts emitted.")
                  return
                }

                console.log(`\n=== Artifacts for Session: ${sessionId} ===\n`)
                console.log("TYPE".padEnd(30), "PRODUCED BY".padEnd(20), "PATH")
                console.log("-".repeat(70))
                for (const artifact of artifacts) {
                  console.log(
                    (artifact.type || "unknown").padEnd(30),
                    (artifact.producedBy || "unknown").padEnd(20),
                    artifact.path || "-",
                  )
                }
                console.log(`\nTotal: ${artifacts.length} artifacts`)
              },
            })
            .command({
              command: "show <session-id> <artifact-type>",
              describe: "Show details of a specific artifact",
              builder: (yargs: Argv) =>
                yargs
                  .positional("session-id", {
                    describe: "session ID",
                    type: "string",
                    demandOption: true,
                  })
                  .positional("artifact-type", {
                    describe: "artifact type (e.g., verification_report)",
                    type: "string",
                    demandOption: true,
                  }),
              handler: async (args) => {
                const sessionId = args["session-id"] as string
                const artifactType = args["artifact-type"] as string
                const snapshot = loadSessionSnapshot(sessionId)

                if (!snapshot) {
                  console.error(`Session not found: ${sessionId}`)
                  process.exit(1)
                }

                const artifacts = snapshot.state?.emittedArtifacts || []
                const artifact = artifacts.find((a: any) => a.type === artifactType)

                if (!artifact) {
                  console.error(`Artifact type '${artifactType}' not found.`)
                  console.log(`Available types: ${artifacts.map((a: any) => a.type).join(", ")}`)
                  process.exit(1)
                }

                console.log(`\n=== Artifact: ${artifactType} ===\n`)
                console.log(`ID: ${artifact.id || artifact.name || "n/a"}`)
                console.log(`Type: ${artifact.type}`)
                console.log(`Description: ${artifact.description || "n/a"}`)
                console.log(`Produced By: ${artifact.producedBy || "unknown"}`)
                console.log(`Path: ${artifact.path || "n/a"}`)
                console.log(`Timestamp: ${artifact.timestamp || "n/a"}`)
              },
            })
            .demandCommand(1, "Please specify artifacts subcommand")
            .help(),
        handler: async () => {},
      })
      .demandCommand(1, "Please specify a workflow command")
  },
  handler: async () => {},
})
