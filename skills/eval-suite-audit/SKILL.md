---
name: "eval-suite-audit"
description: "Audit an AI eval suite for coverage, leakage between datasets, deterministic vs stochastic measurement, ladder correctness, and signal quality. Returns impact-ordered findings tables."
---

# Eval Suite Audit

Use this skill when the task is to review an eval suite for an AI system — the harness that measures whether the model, prompts, and tools actually work. A bad eval suite is worse than no eval suite: it gives confidence where there should be doubt.

## Use when

- the team is about to use eval results to gate a release
- eval scores are suspiciously high or suspiciously stable
- a prompt or model change went green on evals but red in production
- adopting a new evaluation framework and the team wants a sanity check

## Workflow

1. **Inventory the suite.** Find the eval runner, the suites, the datasets, the metrics, the report sink. For DAX specifically: `script/eval.ts`, suites under `evals/`, the `eval:smoke` and `eval:proof` scripts.
2. **Classify metrics.** For each metric, record:
   - What it measures (correctness, latency, cost, determinism, safety)
   - How it scores (exact match, LLM-as-judge, programmatic check, human review)
   - The score range and the pass threshold
3. **Coverage.**
   - Each major user journey or capability has at least one case
   - Edge cases and known-bad inputs included, not only happy paths
   - Negative cases: what the agent should *refuse* or *escalate*
4. **Dataset hygiene.**
   - Training data, system prompts, and few-shot examples are disjoint from eval data
   - Eval data is not pasted into prompts as examples
   - Synthetic eval data is regenerated when prompts change (so the data is not implicitly tuned to a specific prompt)
5. **Determinism vs stochasticity.**
   - Metrics that depend on the model are stochastic — they should be run multiple times and reported with variance, not a single number
   - Metrics that should be deterministic (replay, structured output validity) are run with the same seed and any flake is a finding
6. **Ladder structure.**
   - Smoke / fast: runs on every change, low cost, catches regressions
   - Proof / full: runs before release, comprehensive
   - Each rung has a clear gate (block release if X)
   - Gates not bypassed by a hand-edited "known failures" list without an expiry
7. **LLM-as-judge correctness.**
   - The judge model is different from the model being evaluated (or at least the audit notes the cross-contamination risk)
   - The judge has a rubric, not just "rate 1-10"
   - The judge's outputs are spot-checked by humans periodically
8. **Cost and runtime.**
   - Total cost per run within budget
   - Total runtime within CI budget
   - Cost reported per suite so expensive cases can be paid attention to
9. **Stability and signal.**
   - The same suite + same model + same prompt → same score (within stochastic variance)
   - Score variance reported as part of the result
   - Recent regressions in stable metrics flagged
10. **Reporting and storage.**
    - Results stored historically, not just printed
    - Diffs between runs visible (which cases moved, in which direction)
    - Results tied to the commit / model / prompt-set under test

## Checks

- "It passes" on a single run is not evidence — flag suites that do not report variance for stochastic metrics
- A suite that always passes is suspicious — flag suites with no failures in the last 30 days
- LLM-as-judge alone is not enough for safety-critical metrics — pair with programmatic checks
- Distinguish "coverage gap" (Medium) from "leakage" (High) from "metric does not measure what its name says" (Critical)

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Suites`, `Total cases`, `Models evaluated`, `Ladder rungs`, `Used as release gate?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Metric validity (does each metric measure what its name implies?)
   - Coverage
   - Dataset hygiene and leakage
   - Determinism handling
   - Ladder structure and gating
   - LLM-as-judge correctness
   - Stability and variance reporting
   - Reporting and historical storage
4. **Open questions / assumptions** — intended ladder semantics, intended gate policy
5. **Residual risk** — anything the audit cannot verify without running the suite
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- Eval runner path, suite definitions, dataset paths
- Metric names, score functions, thresholds
- Most recent run results (pass/fail counts, variance if reported)
- Any "known failures" or skip list with its expiry policy
- Whether the suite is wired to a release gate (`release:verify` or equivalent)
