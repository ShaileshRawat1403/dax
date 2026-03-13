# Workflow Design: architecture-map

## 1. Goal

To analyze the repository's structure, identify its core components, and produce a high-level, human-readable architecture map. This provides a quick onboarding tool for new developers and a reference for architecture reviews.

## 2. Trigger

```bash
dax workflow run architecture-map
```

## 3. Steps

This workflow leverages the `ExploreOperator` to deconstruct the repository layer by layer.

| #   | Step Name                | Operator           | Skill Invoked            | Output Artifact       |
| --- | ------------------------ | ------------------ | ------------------------ | --------------------- |
| 1   | **Detect Boundaries**    | `ExploreOperator`  | `boundary-detection`     | `boundaries.json`     |
| 2   | **Detect Entrypoints**   | `ExploreOperator`  | `entrypoint-detection`   | `entrypoints.json`    |
| 3   | **Trace Execution Flow** | `ExploreOperator`  | `execution-flow-tracing` | `execution-flow.json` |
| 4   | **Generate Map**         | `ArtifactOperator` | `map-generator`          | `architecture-map.md` |

## 4. Artifacts

- **`boundaries.json`**: A structured file identifying the key logical boundaries or services within the codebase.
- **`entrypoints.json`**: A list of primary entry points (e.g., API endpoints, CLI commands) for each boundary.
- **`execution-flow.json`**: A representation of how data and control flow between components.
- **`architecture-map.md`**: The final, human-readable document summarizing the architecture with diagrams and descriptions.

## 5. Policies

While primarily an analysis workflow, it can still be governed by policies.

- **`no-circular-dependencies`**: Fails if a circular dependency is detected between major components or boundaries.
- **`enforce-boundary-rules`**: Fails if modules from one boundary directly import private modules from another.

## 6. Final Output

```
DAX Workflow Complete: architecture-map

Trust Score: High (95%)
Policies: 2 passed, 0 failed
Artifacts Generated: 4

Architecture map available at: .dax/sessions/session-xyz/artifacts/architecture-map.md
```
