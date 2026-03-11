import { expect, test, describe, vi } from "bun:test";
import { createTaskGraph, addTask } from "../planner/task-graph";
import { runGraph } from "./run-graph";
import { ExploreOperator } from "../operators/explore";
import { OperatorRouter } from "../operators/router";

describe("Agent Run Graph: Explore Pipeline", () => {
  test("Executes a real explore pipeline and reports milestones in order", async () => {
    // 1. Setup Intent & Plan Graph
    const graph = createTaskGraph("test_explore");

    addTask(graph, {
      id: "task_detect_boundaries",
      name: "Detect Boundaries",
      description: "Identify the project root and boundaries",
      operator_type: "explore",
      dependencies: [],
      context: {},
    });

    addTask(graph, {
      id: "task_detect_entrypoints",
      name: "Detect Entry Points",
      description: "Find runtime entry points",
      operator_type: "explore",
      dependencies: ["task_detect_boundaries"],
      context: {},
    });

    addTask(graph, {
      id: "task_trace_execution_flow",
      name: "Trace Execution Flow",
      description: "Trace execution flow",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: {},
    });

    addTask(graph, {
      id: "task_detect_integrations",
      name: "Detect Integrations",
      description: "Find and map external integrations",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: {},
    });

    addTask(graph, {
      id: "task_generate_report",
      name: "Generate Report",
      description: "Synthesize findings",
      operator_type: "explore",
      dependencies: ["task_trace_execution_flow", "task_detect_integrations"],
      context: {},
    });

    // 2. Setup Router
    const router = new OperatorRouter();
    router.register(new ExploreOperator());

    // 3. Mock milestone reporter and run graph
    const reportedMilestones: { taskID: string; label: string }[] = [];
    const reportMilestone = vi.fn((input: { taskID: string; label: string }) => {
      reportedMilestones.push(input);
    });

    const ctx = { cwd: process.cwd(), sessionId: "test-123", graph, reportMilestone };
    const result = await runGraph(graph, ctx, router);

    // 4. Assertions
    expect(result.success).toBe(true);
    expect(reportMilestone).toHaveBeenCalledTimes(5);

    // Assert exact order of milestones
    expect(reportedMilestones.map(m => m.label)).toEqual([
      "Boundary pass completed",
      "Entry-point pass completed",
      "Execution-flow pass completed",
      "Integrations pass completed",
      "Report prepared",
    ]);
  });
});
