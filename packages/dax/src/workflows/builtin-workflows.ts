import { createTaskGraph, addTask, type TaskGraph } from "../planner/task-graph"

export type WorkflowId = "repo-health" | "explore-repo" | "release-readiness"

export interface WorkflowDefinition {
  id: WorkflowId
  name: string
  description: string
  tasks: Omit<import("../planner/task-graph").PlannedTask, "status">[]
}

export const WORKFLOWS: Record<WorkflowId, WorkflowDefinition> = {
  "repo-health": {
    id: "repo-health",
    name: "Repo Health Check",
    description: "Full health check including explore, verify, artifact indexing, and release readiness",
    tasks: [
      {
        id: "explore-repo",
        name: "Explore Repository",
        description: "Explore the repository structure and generate a map",
        operator_type: "explore",
        dependencies: [],
        context: {},
      },
      {
        id: "verify-repo",
        name: "Verify Repository",
        description: "Run verification checks on the repository",
        operator_type: "verify",
        dependencies: ["explore-repo"],
        context: {},
      },
      {
        id: "index-artifacts",
        name: "Index Artifacts",
        description: "Index and classify all emitted artifacts",
        operator_type: "artifact",
        dependencies: ["explore-repo", "verify-repo"],
        context: {},
      },
      {
        id: "release-readiness",
        name: "Check Release Readiness",
        description: "Assess whether the repository is ready for release",
        operator_type: "release",
        dependencies: ["verify-repo", "index-artifacts"],
        context: {},
      },
    ],
  },
  "explore-repo": {
    id: "explore-repo",
    name: "Explore Repository",
    description: "Explore the repository structure",
    tasks: [
      {
        id: "task_detect_boundaries",
        name: "Detect Boundaries",
        description: "Detect repository boundaries",
        operator_type: "explore",
        dependencies: [],
        context: {},
      },
    ],
  },
  "release-readiness": {
    id: "release-readiness",
    name: "Release Readiness",
    description: "Check release readiness",
    tasks: [
      {
        id: "release-readiness-check",
        name: "Check Release Readiness",
        description: "Check if the repository is ready for release",
        operator_type: "release",
        dependencies: [],
        context: {},
      },
    ],
  },
}

export function buildWorkflowGraph(workflowId: WorkflowId): TaskGraph {
  const workflow = WORKFLOWS[workflowId]
  if (!workflow) {
    throw new Error(`Unknown workflow: ${workflowId}`)
  }

  const graph = createTaskGraph(workflowId)

  for (const task of workflow.tasks) {
    addTask(graph, task)
  }

  return graph
}
