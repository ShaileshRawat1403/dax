# Workflow Design: repo-audit

## 1. Goal

To perform a comprehensive, automated audit of a repository's health, structure, and adherence to policy, producing a clear, actionable report for engineering teams.

## 2. Trigger

```bash
dax workflow run repo-audit
```

## 3. Steps

This workflow is executed as a declarative graph. Each step is owned by a specialist operator and invokes a specific skill.

| #   | Step Name              | Operator           | Skill Invoked         | Output Artifact            |
| --- | ---------------------- | ------------------ | --------------------- | -------------------------- |
| 1   | **Map Dependencies**   | `ExploreOperator`  | `dependency-analysis` | `dependency-graph.json`    |
| 2   | **Analyze Complexity** | `ExploreOperator`  | `code-complexity`     | `complexity-hotspots.json` |
| 3   | **Verify Policy**      | `VerifyOperator`   | `trust-verify`        | `policy-violations.json`   |
| 4   | **Generate Report**    | `ArtifactOperator` | `artifact-audit`      | `audit-report.md`          |

## 4. Artifacts

The workflow is designed to produce verifiable evidence at each stage.

- **`dependency-graph.json`**: A structured JSON file mapping module dependencies across the repository.
- **`complexity-hotspots.json`**: A list of files and functions with the highest cyclomatic complexity scores.
- **`policy-violations.json`**: A structured log of all policy checks that failed during the run.
- **`audit-report.md`**: The final, human-readable markdown report summarizing all findings.

## 5. Policies

The workflow is governed by policies that can be configured for the repository.

- **`tests-required`**: Fails if critical modules lack corresponding test files.
- **`max-complexity-violation`**: Fails if any function exceeds a configured complexity threshold.
- **`banned-dependencies`**: Fails if any disallowed libraries or packages are detected.

## 6. Final Output

The CLI will output a summary and a path to the final report.

```
DAX Workflow Complete: repo-audit

Trust Score: Medium (75%)
Policies: 2 passed, 1 failed (max-complexity-violation)
Artifacts Generated: 4

Final report available at: .dax/sessions/session-xyz/artifacts/audit-report.md
```
