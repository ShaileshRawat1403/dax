# Workflow Design: release-readiness

## 1. Goal

To automatically verify if the current state of the repository is ready for a production release. This workflow acts as a final gatekeeper, ensuring that quality, documentation, and stability standards are met.

## 2. Trigger

```bash
dax workflow run release-readiness
```

## 3. Steps

This workflow uses the `VerifyOperator` to run a series of checks against the codebase and its artifacts.

| #   | Step Name                | Operator           | Skill Invoked             | Output Artifact                  |
| --- | ------------------------ | ------------------ | ------------------------- | -------------------------------- |
| 1   | **Check Test Coverage**  | `VerifyOperator`   | `test-coverage-check`     | `test-coverage.json`             |
| 2   | **Verify Docs**          | `VerifyOperator`   | `docs-completeness-check` | `docs-status.json`               |
| 3   | **Check Release Policy** | `VerifyOperator`   | `release-policy-check`    | `release-policy-violations.json` |
| 4   | **Generate Summary**     | `ArtifactOperator` | `summary-generator`       | `release-readiness.md`           |

## 4. Artifacts

- **`test-coverage.json`**: A structured report showing test coverage statistics for each module.
- **`docs-status.json`**: A report detailing the documentation status of all public APIs and components.
- **`release-policy-violations.json`**: A structured log of any release-specific policies that failed.
- **`release-readiness.md`**: The final, human-readable summary report with a clear "Go / No-Go" recommendation and a list of blockers.

## 5. Policies

This workflow is almost entirely driven by policy.

- **`min-test-coverage-80-percent`**: Fails if the overall test coverage is below 80%.
- **`all-public-apis-documented`**: Fails if any public function, class, or API endpoint is missing documentation.
- **`no-open-high-severity-issues`**: Fails if there are open tickets in the issue tracker with a "high-severity" or "blocker" label. This would require an integration with an issue tracking system.

## 6. Final Output

The CLI provides a clear, unambiguous release recommendation.

```
DAX Workflow Complete: release-readiness

Result: NO-GO
Reason: Release blocked by 2 outstanding issues.

Blockers:
- Policy "min-test-coverage-80-percent" failed (Coverage is 76%).
- Policy "all-public-apis-documented" failed (2 endpoints undocumented).

Full report available at: .dax/sessions/session-xyz/artifacts/release-readiness.md
```
