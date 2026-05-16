---
name: "ci-cd-audit"
description: "Audit CI/CD workflows for correctness, caching, action pinning, secret hygiene, and job-graph health. Returns impact-ordered findings tables."
---

# CI/CD Audit

Use this skill when the task is to review a repository's CI/CD configuration as a whole — workflow files, job graphs, caching, secrets usage, and reusable-action pinning. For pure security review of GitHub Actions, prefer [gh-actions-security](../gh-actions-security/SKILL.md). For the release-publishing path specifically, prefer [release-pipeline-audit](../release-pipeline-audit/SKILL.md).

## Use when

- the user asks for a CI/CD review or audit
- workflows have grown and nobody has a clear picture of the job graph
- builds are slow and the cause is unclear
- a new contributor asks "what does CI even do here"
- a workflow change is about to land and the user wants a second opinion

## Workflow

1. **Inventory.** List every workflow file under `.github/workflows/` (and `circleci`, `gitlab-ci.yml`, `bitbucket-pipelines.yml`, `azure-pipelines.yml` if present). For each, record: triggers, jobs, runners, timeout, concurrency rules.
2. **Job graph.** For each workflow, sketch which jobs depend on which (`needs:`), where the parallelism is, and where the critical path is.
3. **Action pinning.** Flag any third-party action referenced by mutable tag (`@v3`, `@main`) instead of by full commit SHA. First-party actions (`actions/checkout`, `actions/setup-*`) may use major-version tags if that's the repo convention — note the convention.
4. **Cache hygiene.** Check for missing or wrong cache keys: lockfile-based keys for dependency caches, content-hash keys for build artifacts. Flag caches that never invalidate or always miss.
5. **Secret usage.** Look for secrets referenced in `if:` conditions, `env:` at workflow level that leak to forked PRs, or `${{ secrets.* }}` in `run:` steps where the secret ends up in process args. Defer hard security findings to [gh-actions-security](../gh-actions-security/SKILL.md).
6. **Trigger correctness.** `pull_request` vs `pull_request_target` — flag `pull_request_target` runs that check out untrusted code. `push` triggers on tags vs branches. `workflow_dispatch` inputs and their defaults.
7. **Runner choice.** Right-sized runners, self-hosted vs hosted, ARM vs x64. Flag `ubuntu-latest` pinning where reproducibility matters.
8. **Concurrency and cancellation.** `concurrency:` groups with `cancel-in-progress` set correctly so deploys don't race and PR runs don't pile up.
9. **Timeout.** Every job should have `timeout-minutes` set. Flag jobs without one.
10. **Status visibility.** Required-checks list in branch protection should match the names the workflows actually emit. Flag mismatches.
11. **Re-runnability.** Workflows should be idempotent — flag side effects outside the runner (DB writes, cache poisoning) that make re-runs unsafe.

## Checks

- Distinguish first-party (`actions/*`) from third-party actions before flagging pin-by-tag
- Do not flag `ubuntu-latest` unless the workflow has reproducibility requirements (releases, security scans)
- If the repo has a documented convention (CONTRIBUTING.md, docs/ci.md), honor it instead of imposing generic best practice
- Skip jobs gated behind `if: github.repository == ...` when auditing fork behavior — they don't run on forks
- When a workflow uses a reusable workflow (`uses: ./.github/workflows/...` or `uses: org/repo/.github/workflows/...`), recurse into it

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line: `ready` / `ready with caveats` / `not ready` + a small table:
   - `Workflows scanned`, `Jobs`, `Third-party actions`, `Self-hosted runners?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Action pinning
   - Secret usage
   - Cache hygiene
   - Trigger correctness
   - Job graph and concurrency
   - Timeout and re-runnability
   - Runner choice
4. **Open questions / assumptions** — anything that needed user context (intended convention, intended scope of a workflow, etc.)
5. **Next actions** — concrete fixes in order

## Evidence to collect

- File path + line for every flagged item
- The exact pinned ref (`@v3.2.1`, `@a1b2c3d`, or `@main`) for action pinning findings
- The cache key string verbatim for cache findings
- Workflow name + job name for graph findings
