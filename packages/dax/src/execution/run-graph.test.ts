import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { mkdirSync, rmSync } from "fs"
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
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(testHome, { recursive: true, force: true })
  })

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
    const cwd = path.resolve("../../test/fixtures/healthy-repo")
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
