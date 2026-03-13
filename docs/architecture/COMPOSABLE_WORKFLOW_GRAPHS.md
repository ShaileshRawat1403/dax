# Architecture: Composable Workflow Graphs

## 1. Purpose

To evolve DAX from a workflow runner into a workflow platform. This is achieved by enabling workflows to be composed into larger, governed execution graphs. This allows DAX to orchestrate complex systems of work, not just isolated tasks, making it a true execution control plane for the SDLC.

## 2. Core Principles

The DAX platform is built on a clear hierarchy of reusable components:

- **Skills**: The smallest reusable capability units (e.g., `dependency-analysis`).
- **Operators**: Execute domain-specific work by invoking skills (e.g., `ExploreOperator`).
- **Workflows**: Orchestrate operators and skills to accomplish a single, concrete job (e.g., `repo-audit`).
- **Composite Workflows**: Orchestrate other workflows and operators to execute a larger, system-level process (e.g., `project-health`).

## 3. Graph Compilation Model

DAX will use a **flattened graph expansion** model. Before runtime, a composite workflow is compiled into a single, unified execution graph.

This is preferred over nested workflow execution because it provides:

- A single, inspectable graph state.
- A unified approval and policy model.
- A single, traceable artifact index.
- A coherent trust ledger.
- Simplified resumability from any failed or blocked node.

## 4. Graph Node Taxonomy

The execution graph will support a variety of node types beyond simple operator steps:

```ts
type GraphNodeType =
  | "operator_step"
  | "workflow_step"
  | "policy_gate"
  | "approval_gate"
  | "artifact_transform"
  | "finalize"
```

## 5. Key Platform Capabilities

### 5.1. Workflow-as-Node Contract

A workflow can be invoked as a single node within a larger graph.

```ts
interface WorkflowNode {
  id: string
  type: "workflow_step"
  workflow_id: string // The ID of the workflow to invoke
  input_artifacts?: ArtifactBinding[]
  output_artifacts?: string[]
  dependencies: string[]
  on_failure?: "stop" | "continue" | "degrade"
}
```

### 5.2. Artifact Passing & Binding

Artifacts are first-class citizens that flow between nodes, preventing re-computation.

```ts
interface ArtifactBinding {
  from_node: string
  artifact_type: string
  to_node: string
  as_input: string
}
```

### 5.3. Trust Propagation & Aggregation

Each node in the graph can affect a session's trust score. The trust state of a child workflow is aggregated into the parent workflow's final trust summary.

```ts
interface WorkflowTrustSummary {
  trust_level: "high" | "medium" | "low"
  blockers: string[]
  warnings: string[]
  inherited_from: string[] // List of nodes that contributed to the summary
}
```

### 5.4. Policy Gates

Policy gates are nodes in the graph that enforce rules before allowing execution to proceed.

```ts
interface PolicyGateNode {
  id: string
  type: "policy_gate"
  dependencies: string[]
  required_conditions: string[] // e.g., "artifact_exists:audit-report.md", "trust_level_not_low"
  on_failure: "stop" | "approval" | "degrade"
}
```

### 5.5. Resumability

Every workflow run must be resumable. The state of each node (pending, running, completed, failed, blocked), along with all generated artifacts and trust signals, must be persisted. This allows the system to resume from the point of failure.

## 6. Reference Implementation: `project-health`

`project-health` is the first official composite workflow. It provides a holistic view of a repository's quality, architecture, and release-readiness.

**Composition:**

```
project-health
├─ 1. architecture-map (Workflow)
├─ 2. repo-audit (Workflow)
└─ 3. release-readiness (Workflow)
```

**Execution Flow:**

1.  Run the `architecture-map` workflow.
2.  **Artifact Binding**: The artifacts from `architecture-map` (e.g., `boundaries.json`, `entrypoints.json`) are passed as inputs to the `repo-audit` workflow.
3.  Run the `repo-audit` workflow.
4.  **Policy Gate**: A policy gate checks the trust score from the audit. If the trust is `low`, the graph is blocked pending approval.
5.  **Trust Propagation**: The trust results from the previous two workflows are aggregated.
6.  Run the `release-readiness` workflow, passing in the aggregated context.
7.  A final `finalize` node compiles all artifacts and trust summaries into a final `project-health-report.md`.

## 7. Proposed Directory Structure

```
packages/dax/src/workflows/
├── types.ts              # Core types: Workflow, WorkflowStep, etc.
├── registry.ts           # Registers available workflows
├── run-workflow.ts       # The main workflow execution engine
├── compose.ts            # Logic for flattened graph expansion
├── trust.ts              # Trust aggregation logic
├── artifacts.ts          # Artifact binding and passing logic
├── gates.ts              # Policy gate evaluation logic
└── builtins/             # Directory for official workflow definitions
    ├── repo-audit.ts
    ├── architecture-map.ts
    ├── release-readiness.ts
    └── project-health.ts
```

## 8. CLI & TUI Impact

- **CLI**: The primary user interaction will be through `dax workflow <command>`.
  - `list`: Shows available workflows from the registry.
  - `run <workflow-id>`: Executes a workflow.
  - `inspect <workflow-id>`: Shows the design and steps of a workflow.
- **TUI**: The existing TUI will remain stable. It will be enhanced to surface high-level information about the composite run, such as the active parent workflow, the current child workflow or node, and the aggregated trust summary.
