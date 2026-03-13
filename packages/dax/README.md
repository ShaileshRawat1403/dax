# DAX Package

This package contains the canonical shipped DAX product.

## Workflow Commands (v1)

DAX v1 provides governed CLI workflows for repository health, verification, and release-readiness assessment.

### Available Commands

```bash
# List available workflows
dax workflow list

# Run the repo-health workflow on a repository
dax workflow run repo-health <path>

# Inspect a completed workflow session
dax workflow inspect <session-id>

# List artifacts from a workflow session
dax workflow artifacts list <session-id>

# Show details of a specific artifact
dax workflow artifacts show <session-id> <artifact-type>
```

### Artifacts

The `repo-health` workflow produces these structured artifacts:

| Artifact                | Description                              |
| ----------------------- | ---------------------------------------- |
| `explore_report`        | Repository structure and boundaries      |
| `verification_report`   | Verification checks and trust assessment |
| `artifact_inventory`    | Indexed artifacts from the workflow      |
| `release_readiness`     | Governance gates and release status      |
| `workflow-summary.json` | Top-level workflow result (JSON)         |

### Governance

DAX v1 includes governance gates that can block releases:

- **Missing verification report**: Blocks release
- **Low trust score** (<0.4): Blocks release
- **Critical findings**: Blocks release
- **High-impact risks**: Blocks release

---

Start at the repository root for product docs and contribution guidance:

- [README](../../README.md)
- [Architecture](../../ARCHITECTURE.md)
- [Contributor Start Here](../../docs/CONTRIBUTOR_START_HERE.md)
- [Contributing](../../CONTRIBUTING.md)
- [License](../../LICENSE)
