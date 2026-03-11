import { expect, test, describe } from "bun:test";
import { createTaskGraph, addTask } from "../planner/task-graph";
import { runGraph } from "./run-graph";
import { ExploreOperator } from "../operators/explore";
import { OperatorRouter } from "../operators/router";

describe("Agent Run Graph: Explore Pipeline", () => {
  test("Executes a real explore pipeline correctly", async () => {
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
      name: "Map Architecture",
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

    // 3. Run Graph (against the current dax repo)
    // Pass the graph into the context so the operator can read previous task results
    const ctx = { cwd: process.cwd(), sessionId: "test-123", graph };
    const result = await runGraph(graph, ctx, router);

    // 4. Assertions
    expect(result.success).toBe(true);
    expect(result.failedTasks.length).toBe(0);
    expect(result.blockedTasks.length).toBe(0);
    
    expect(graph.status).toBe("completed");
    
    const boundariesTask = graph.tasks.get("task_detect_boundaries")!;
    expect(boundariesTask.status).toBe("completed");
    expect(boundariesTask.result).toBeDefined();

    const reportTask = graph.tasks.get("task_generate_report")!;
    expect(reportTask.status).toBe("completed");
    
    // The final report output should be a valid RepoExploreResult
    const reportOutput = reportTask.result as any;
    expect(reportOutput.sections).toBeDefined();
    expect(reportOutput.sections.length).toBeGreaterThan(0);
  });
});

