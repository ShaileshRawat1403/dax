import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import path from "path"
import { runGraph } from "../../execution/run-graph"
import { createInitializedRouter } from "../../operators/router"
import { buildWorkflowGraph, type WorkflowId } from "../../workflows/builtin-workflows"
import { SessionStateManager } from "../../session/update-state"
import type { SessionState } from "../../session/state-types"

function createInitialSessionState(sessionId: string, cwd: string): SessionState {
  return {
    id: sessionId,
    status: "active",
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

export const WorkflowCommand = cmd({
  command: "workflow [workflow] [path]",
  describe: "Run a DAX workflow",
  builder: (yargs: Argv) =>
    yargs
      .positional("workflow", {
        describe: "workflow to run",
        type: "string",
        default: "repo-health",
      })
      .positional("path", {
        describe: "repository path to run workflow on",
        type: "string",
        default: ".",
      })
      .option("resume", {
        describe: "resume from a previous session",
        type: "string",
        description: "session ID to resume",
      }),
  handler: async (args) => {
    const target = String(args.path ?? ".").replace(/\0/g, "")
    const resolvedTarget = path.resolve(target)
    const workflowId = (args.workflow as WorkflowId) || "repo-health"

    await bootstrap(resolvedTarget, async () => {
      console.log(`Running workflow: ${workflowId} on ${resolvedTarget}`)

      // 1. Build workflow graph
      const graph = buildWorkflowGraph(workflowId)

      // 2. Setup session state
      const sessionId = args.resume || `workflow-${Date.now()}`
      const initialState = createInitialSessionState(sessionId, resolvedTarget)
      const stateManager = new SessionStateManager(initialState)
      stateManager.updateWorkflow(workflowId)

      // 3. Setup router
      const router = createInitializedRouter()

      // 4. Run the workflow
      const result = await runGraph(graph, { cwd: resolvedTarget, sessionId }, router, stateManager)

      // 5. Output results
      console.log("\n--- Workflow Result ---")
      console.log(`Success: ${result.success}`)
      console.log(`Failed tasks: ${result.failedTasks.join(", ") || "none"}`)
      console.log(`Blocked tasks: ${result.blockedTasks.join(", ") || "none"}`)

      console.log("\n--- Session Summary ---")
      const summary = stateManager.getState()
      console.log(`Findings: ${summary.findings.length}`)
      console.log(`Risks: ${summary.risks.length}`)
      console.log(`Artifacts: ${summary.emittedArtifacts.length}`)
      console.log(`Trust Score: ${Math.round(summary.trustState.score * 100)}%`)
      console.log(`Trust Posture: ${summary.trustState.posture}`)

      if (!result.success) {
        process.exit(1)
      }
    })
  },
})
