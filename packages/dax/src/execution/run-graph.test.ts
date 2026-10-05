import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { mkdirSync, rmSync } from "fs"
import { createGrantReviewedRun } from "./run-factory"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { grantReviewPath } from "./grant-review-barrier"
import { readRunEvents } from "@/state/events/run-event-store"
import { createTaskGraph, addTask } from "../planner/task-graph"
import { runGraph } from "./run-graph"
import { ExploreOperator } from "../operators/explore"
import { OperatorRouter } from "../operators/router"
import type { Operator } from "../operators/base"
import { Instance } from "../project/instance"

describe("Agent Run Graph: Explore Pipeline", () => {
  const testHome = path.join(os.tmpdir(), `dax-run-graph-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(() => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(path.join(testHome, ".config", "dax"), { recursive: true })
  })

  afterEach(async () => {
    await Instance.disposeAll()
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(testHome, { recursive: true, force: true })
  })

  for (const mode of ["root", "child", "lost-private-review", "malformed-session", "mismatched-session", "missing-governing-contract", "missing-session"] as const) {
    test(`reviewed ${mode} authority refuses graph effects`, async () => {
      const cwd = path.join(testHome, "project")
      mkdirSync(cwd, { recursive: true })
      await Instance.provide({ directory: cwd, fn: async () => {
        const { runId } = await createGrantReviewedRun({
          request: { intent: { input: "Inspect the repository, read only." } },
          availableTools: ["read"],
        })
        let sessionId = runId
        if (["child", "malformed-session", "mismatched-session", "missing-governing-contract", "missing-session"].includes(mode)) {
          const child = await Session.createNext({ directory: cwd, parentID: runId, governingRunId: runId })
          sessionId = child.id
          if (mode === "malformed-session") {
            await Storage.write(["session", Instance.project.id, child.id], { ...child, governingRunId: "not-a-session" })
          }
          if (mode === "mismatched-session") {
            await Storage.write(["session", Instance.project.id, child.id], { ...child, id: "ses_unrelated", governingRunId: undefined })
          }
        }
        if (mode === "missing-governing-contract") {
          await Session.update(sessionId, (draft) => { draft.governingRunId = "ses_missing_graph_authority" })
        }
        if (mode === "missing-session") await Storage.remove(["session", Instance.project.id, sessionId])
        if (mode === "lost-private-review") await Storage.remove(grantReviewPath(runId))
        const before = await readRunEvents(runId)
        const graph = createTaskGraph("reviewed_graph")
        addTask(graph, {
          id: "effect", name: "Effect", description: "Must not execute", operator_type: "controlled",
          dependencies: [], context: {},
        })
        let effects = 0
        const router = new OperatorRouter()
        router.register({ type: "controlled", async execute() { effects++; return { success: true, output: {} } } })
        const result = await runGraph(graph, { cwd, sessionId }, router)
        expect(effects).toBe(0)
        expect(result.success).toBe(false)
        expect(result.failedTasks).toEqual(["effect"])
        if (["malformed-session", "mismatched-session", "missing-governing-contract", "missing-session"].includes(mode)) {
          expect(graph.tasks.get("effect")?.error).toHaveProperty("reasonCode", "authority_unreadable")
        } else {
          expect(graph.tasks.get("effect")?.error).toHaveProperty("code", "grant_review_non_executable")
        }
        expect(await readRunEvents(runId)).toEqual(before)
      } })
    })
  }

  test("Executes a real explore pipeline in correct order", async () => {
    // 1. Setup Intent & Plan Graph
    const graph = createTaskGraph("test_explore")

    addTask(graph, {
      id: "task_detect_boundaries",
      name: "Detect Boundaries",
      description: "Identify the project root and boundaries",
      operator_type: "explore",
      dependencies: [],
      context: {},
    })

    addTask(graph, {
      id: "task_detect_entrypoints",
      name: "Detect Entry Points",
      description: "Find runtime entry points",
      operator_type: "explore",
      dependencies: ["task_detect_boundaries"],
      context: {},
    })

    addTask(graph, {
      id: "task_trace_execution_flow",
      name: "Trace Execution Flow",
      description: "Trace execution flow",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: {},
    })

    addTask(graph, {
      id: "task_detect_integrations",
      name: "Detect Integrations",
      description: "Find and map external integrations",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: {},
    })

    addTask(graph, {
      id: "task_generate_report",
      name: "Generate Report",
      description: "Synthesize findings",
      operator_type: "explore",
      dependencies: ["task_trace_execution_flow", "task_detect_integrations"],
      context: {},
    })

    // 2. Setup Router
    const router = new OperatorRouter()
    router.register(new ExploreOperator())

    // 3. Execution
    const cwd = path.resolve(import.meta.dir, "../../../../test/fixtures/healthy-repo")
    const result = await Instance.provide({
      directory: cwd,
      fn: () => runGraph(graph, { cwd, sessionId: "test_session" }, router),
    })

    // 4. Assertions
    expect(result.success).toBe(true)
    expect(result.failedTasks).toHaveLength(0)

    // Verify all tasks completed
    const tasks = Array.from(graph.tasks.values())
    const completedTasks = tasks.filter((t) => t.status === "completed")
    expect(completedTasks.length).toBe(5)
  })

  test("fails honestly when verification criteria exist without a verification handoff", async () => {
    const graph = createTaskGraph("verification_gap")
    addTask(graph, {
      id: "task_requires_verification",
      name: "Needs verification",
      description: "Task with verification criteria",
      operator_type: "mock",
      dependencies: [],
      context: {},
      verification_criteria: ["evidence exists"],
    })

    const router = new OperatorRouter()
    router.register({
      type: "mock",
      async execute() {
        return {
          success: true,
          output: { ok: true },
        }
      },
    } satisfies Operator)

    const cwd = process.cwd()
    const result = await Instance.provide({
      directory: cwd,
      fn: () => runGraph(graph, { cwd, sessionId: "test_session" }, router),
    })

    expect(result.success).toBe(false)
    expect(result.failedTasks).toContain("task_requires_verification")
    expect(result.warnings).toContain("verification unavailable for task task_requires_verification")
  })
})
