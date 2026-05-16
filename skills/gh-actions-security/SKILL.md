---
name: "gh-actions-security"
description: "Security-focused review of GitHub Actions workflows: pull_request_target misuse, expression injection, privileged token misuse, supply-chain exposure. Returns impact-ordered findings tables."
---

# GitHub Actions Security

Use this skill when the task is to find security bugs in GitHub Actions workflows. Scope is narrower than [ci-cd-audit](../ci-cd-audit/SKILL.md) — it only covers the class of bugs that turn a CI into a privilege-escalation or RCE primitive.

## Use when

- the user asks for a security review of CI workflows
- a workflow uses `pull_request_target` and accepts contributions from forks
- a workflow checks out PR head code with write permissions
- a third-party action was recently added or updated
- a security audit needs a record of CI exposure

## Workflow

1. **Inventory workflows.** Enumerate every file under `.github/workflows/` and any reusable workflow paths referenced from them.
2. **Classify trigger safety.**
   - `pull_request` runs in the fork's context — usually safe.
   - `pull_request_target` runs in the *base* context with full secret access, on attacker-controlled code if `actions/checkout` is given the PR head ref. This is the #1 GitHub Actions exploit primitive.
   - `issue_comment`, `pull_request_review`, `workflow_run` all run with base-repo secrets and need extra scrutiny.
3. **Expression injection.**
   - Any `${{ github.event.* }}` value interpolated directly into a `run:` script is an injection sink. Common offenders: `github.event.pull_request.title`, `github.event.pull_request.body`, `github.event.issue.title`, `github.head_ref` (when not sanitized).
   - The safe pattern is to read the value into an env var first (`env: TITLE: ${{ github.event.pull_request.title }}`) and reference `$TITLE` from the script.
4. **`GITHUB_TOKEN` permissions.**
   - Workflow-level `permissions:` should be minimal. Default-permissive workflows expand the blast radius of any other bug.
   - Flag any workflow without an explicit top-level `permissions:` block.
   - Flag `permissions: write-all` or per-scope `write` that the workflow does not actually need.
5. **Third-party action pinning.**
   - Third-party actions (anything not `actions/*` or your own org's) must be pinned to a full commit SHA, not a tag. Tags are mutable.
   - Note when an org has been compromised in the past — those actions need extra scrutiny even when SHA-pinned.
6. **Untrusted checkout patterns.**
   - `actions/checkout` with `ref: ${{ github.event.pull_request.head.sha }}` plus `pull_request_target` plus a `run:` step that executes anything from the checked-out tree = RCE.
   - The same pattern with `pull_request` is safer because secrets are not exposed.
7. **Cache poisoning.**
   - Cache keys that include attacker-controlled values (PR title, branch name) can be poisoned and reused by later runs. Flag cache scopes that span trust boundaries.
8. **Self-hosted runner exposure.**
   - Self-hosted runners must not run untrusted workflows. Flag any self-hosted runner reachable from a `pull_request` workflow that does not gate on author or label.
9. **Secret echo.**
   - Look for `echo`, `set -x`, `cat`, or any logging step that could surface a secret. Even masked secrets leak when base64-encoded or split across lines.
10. **Composite action and reusable workflow trust.**
    - Reusable workflows inherit secrets when explicitly passed. Walk into any reusable workflow and re-apply this checklist there.

## Checks

- Do not flag `pull_request_target` outright — flag the unsafe variant (PR head checkout + run from tree)
- Distinguish "could be exploited" (Critical/High) from "violates best practice" (Medium/Low) — be explicit
- Avoid false positives on dependabot-managed action bumps that move from SHA to SHA legitimately
- When a workflow is gated by `if: github.actor == 'maintainer'`, note that this is a weak control (attackers can spoof via PR title in some patterns) but not always a finding

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Workflows scanned`, `Forks accepted?`, `Self-hosted runners?`, `Top permission scope`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Trigger safety and untrusted checkout
   - Expression injection
   - `GITHUB_TOKEN` permissions
   - Third-party action pinning
   - Self-hosted runner exposure
   - Cache and secret exposure
4. **Open questions / assumptions** — gating mechanisms the audit could not verify
5. **Residual risk** — anything outside the workflow files (org-level settings, runner-host config)
6. **Next actions** — concrete fixes in order; for Critical findings, propose the exact patch

## Evidence to collect

- Workflow file path + line number for every flagged item
- The trigger event and its payload fields used by the workflow
- The exact `permissions:` block at workflow and job level
- The exact `uses:` ref (tag or SHA) for every third-party action
- For expression-injection findings, the exact `${{ }}` interpolation site and its destination (`run:`, `if:`, etc.)
