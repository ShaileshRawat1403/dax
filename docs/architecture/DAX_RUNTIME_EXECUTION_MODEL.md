# Runtime Execution Model

## 1. Overview

This document defines the core runtime execution model for DAX. It describes the flow of execution from the moment a user provides an intent to the final delivery of artifacts, trust signals, and policy evaluations.

## 2. Execution Pipeline

The DAX runtime follows a strict, deterministic pipeline:

1.  **Intent Resolution**: Parses the user's input to identify the target operation (e.g., `explore`, `workflow`, `audit`).
2.  **Workflow Resolution**: Identifies the target workflow. If the intent is a composite workflow, it triggers the expansion process.
3.  **Graph Compilation**: Resolves the workflow definition into an executable task graph. This includes flattening any nested sub-workflows.
4.  **Scheduling**: Orders the tasks in the graph based on their dependencies.
5.  **Execution**: Iterates through the graph, invoking the appropriate operator for each task.
6.  **Artifact Collection**: Captures and stores artifacts produced by operators.
7.  **Policy Evaluation**: Runs relevant policies against the artifacts and execution results.
8.  **Trust Aggregation**: Aggregates the trust signals from all tasks to produce a final trust score.
9.  **Finalization**: Compiles all outputs (artifacts, policies, trust) into a final result dossier.

## 3. Core Interfaces

### 3.1. Intent

Represents the user's goal.

```ts
interface Intent {
  type: "explore" | "workflow" | "audit" | "general_query"
  raw: string
  target?: string // e.g., workflow ID
  parameters?: Record<string, any>
}
```

### 3.2. Workflow

A declarative definition of a job.

```ts
interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
  artifacts?: ArtifactDefinition[]
  policies?: string[]
}

interface WorkflowStep {
  id: string
  operator: string // e.g., 'ExploreOperator'
  skill?: string // Optional: explicit skill to invoke
  dependencies?: string[]
  produces?: ArtifactDefinition[]
  requires?: string[] // Required artifacts
}
```

### 3.3. Execution Graph

The runtime representation of a workflow.

```ts
interface ExecutionGraph {
  id: string
  workflowId: string
  nodes: GraphNode[]
  status: "pending" | "running" | "completed" | "failed" | "blocked"
}

interface GraphNode {
  id: string
  type: "operator" | "workflow" | "policy_gate"
  status: "pending" | "running" | "completed" | "failed" | "blocked"
  result?: any
  error?: Error
  inputArtifacts?: Artifact[]
  outputArtifacts?: Artifact[]
}
```

### 3.4. Artifact

Evidence of work produced by an operator.

```ts
interface Artifact {
  id: string
  type: string
  name: string
  path: string
  content?: any
  metadata: {
    producedBy: string
    timestamp: string
    sessionId: string
    workflowId: string
  }
}
```

### 3.5. Policy

A rule that evaluates the result of execution.

```ts
interface Policy {
  id: string
  name: string
  evaluate(context: PolicyContext): PolicyResult
}

interface PolicyResult {
  passed: boolean
  message?: string
  severity: "info" | "warning" | "error"
}
```

## 4. Workflow Expansion (Composition)

When a composite workflow is executed, the runtime performs a "flattening" operation.

**Process:**

1.  Identify all sub-workflows in the graph.
2.  Recursively expand each sub-workflow into its constituent nodes.
3.  Resolve artifact bindings (pass outputs of one node to inputs of another).
4.  Produce a single, flat `ExecutionGraph`.

This ensures that the entire execution chain is visible, inspectable, and resumable from a single state object.

## 5. Artifact Lifecycle

1.  **Generated**: An operator creates an artifact during execution.
2.  **Stored**: The artifact is saved to the session's artifact store.
3.  **Indexed**: The artifact is added to the session's artifact index.
4.  **Bound**: If another node requires this artifact, it is passed to that node's input context.
5.  **Evaluated**: Policies inspect the artifact to ensure compliance.

## 6. Trust Model

Trust is a first-class citizen in the runtime.

- Each operator can emit a `TrustDelta` (positive or negative change).
- The runtime maintains a running trust score.
- At the end of a workflow, a `WorkflowTrustSummary` is generated.
- Composite workflows aggregate trust scores from their child workflows.

## 7. Resumability

The runtime must support pausing and resuming.

**Required State:**

- Current graph status.
- Status of each node.
- All generated artifacts.
- Current trust score.
- Pending approval requests.

This state is persisted in the session object.
