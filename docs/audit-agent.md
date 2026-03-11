# DAX Audit Agent (Beta)

The `audit` agent helps teams run release-readiness and governance checks from natural language, CLI, and CI.

## Enable Beta

```bash
export DAX_AUDIT_BETA=1
```

Optional overrides:

```bash
export DAX_AUDIT_PROFILE=strict
export DAX_AUDIT_AUTOTRIGGERS=before_release,after_pr_review
```

## Commands

```bash
/audit
/audit profile strict
/audit gate
/audit explain <finding_id>
```

CLI equivalents:

```bash
dax audit
dax audit run --profile strict
dax audit gate --profile strict
dax audit explain <finding_id>
dax audit profile balanced
dax audit events --type audit
```

## Trust Summary

`dax audit` is the default trust surface.

It summarizes:

- pending approvals
- recorded overrides
- evidence presence
- audit findings and posture

Use it when the operator question is:

- what happened that matters for trust?
- is this execution trail reviewable?

Use `dax audit events` only when low-level RAO event history is needed.

## Profiles

- `strict`: blocks critical findings and high findings in fail-on categories.
- `balanced`: blocks only critical findings.
- `advisory`: never blocks; reports guidance only.

## Output Contract

Each run returns:

1. Human summary (markdown)
2. Structured JSON (`run_id`, `status`, `findings[]`, `summary`, `next_actions`)

Use the JSON in CI or automation.

## Auto Triggers

Configured with `config.audit.auto_triggers` (or `DAX_AUDIT_AUTOTRIGGERS`):

- `before_release`
- `after_pr_review`
- `after_config_change`
- `after_docs_policy_change`

Only enabled triggers auto-run.

## For Non-Developers

Read these fields first:

1. `status`
2. `summary.blocker_count`
3. top `next_actions`

If blockers are non-zero, resolve those first.

## Screenshot Placeholders

### 1) Audit pass

Capture:
- Right pane in `audit` mode
- `status: pass`
- zero blockers visible

### 2) Audit fail with blockers

Capture:
- `status: fail`
- blocker count
- at least one `BLOCKER` line and fix text

### 3) Profile switch flow

Capture:
- `/audit profile strict|balanced|advisory`
- follow-up `/audit gate` output
