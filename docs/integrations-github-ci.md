# DAX Integrations: GitHub + CI (Audit Lane)

This guide covers the first integration lane for the `audit` agent.

## CI Artifact

`release:check` writes:

- `artifacts/audit-result.json`

Run locally:

```bash
bun run release:check
cat artifacts/audit-result.json
```

## GitHub Actions Pattern

Recommended flow:

1. Run `bun run release:check`
2. Upload `artifacts/audit-result.json` as workflow artifact
3. Optionally parse blockers and fail release jobs

Example step:

```yaml
- name: Release checks
  run: bun run release:check

- name: Upload audit artifact
  uses: actions/upload-artifact@v4
  with:
    name: audit-result
    path: artifacts/audit-result.json
```

## Release Gate Pattern

Use strict profile in protected branches:

```bash
dax audit gate --profile strict
```

Exit code behavior:

- `0`: pass
- `1`: blocking findings present

## GitHub Integration Config (Optional)

```json
{
  "audit": {
    "enabled": true,
    "profile": "strict",
    "auto_triggers": ["before_release", "after_pr_review"]
  },
  "integration": {
    "github": {
      "enabled": true,
      "checks": true,
      "pr_comment": true,
      "issue_annotations": true
    }
  }
}
```

## Screenshot Placeholders

### 1) CI artifact upload

![GitHub Actions run with uploaded audit-result artifact](./images/integration-01-ci-artifact.png)

Capture:
- Workflow summary page
- artifact named `audit-result`

### 2) Gate failure

![Workflow log showing audit gate fail and blocker count](./images/integration-02-gate-fail.png)

Capture:
- `AUDIT_GATE_FAIL` line
- blocker count in logs

