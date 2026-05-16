---
name: "observability-audit"
description: "Audit observability for a service or system: structured logging, metrics for golden signals, distributed tracing, dashboard quality, alert noise, SLO definitions. Returns impact-ordered findings tables."
---

# Observability Audit

Use this skill when the task is to evaluate whether a service can be operated by people who did not build it. "We have observability" usually means "we have a Grafana folder and a Slack channel" — this audit asks whether the signals are actually load-bearing.

## Use when

- a service is preparing for production (pair with [deploy-readiness](../deploy-readiness/SKILL.md))
- on-call is loud and the question is which alerts are noise vs. signal
- a postmortem identified blind spots
- SLO work is starting and the team needs to know what they can measure today

## Workflow

1. **Inventory signals.**
   - Logging library and format
   - Metrics library and emission strategy (push, pull, periodic flush)
   - Tracing library and propagation pattern
   - Where each signal lands (log aggregator, metric store, trace backend)
2. **Logging quality.**
   - Structured (JSON or logfmt), not free-form strings
   - Every request carries a request id; every span emits a trace id
   - Log levels used correctly: `error` reserved for actionable, `warn` for surprising, `info` for state transitions, `debug` for development noise
   - Sensitive fields (tokens, PII, full bodies) redacted before write
   - Log volume bounded — flag log-per-iteration patterns in hot paths
3. **Metric coverage.**
   - **Rate** — request rate per endpoint and per status class
   - **Errors** — error rate per endpoint with reason labels (cardinality-bounded)
   - **Duration** — request duration histogram per endpoint (p50/p95/p99 extractable)
   - **Saturation** — queue depth, connection pool usage, worker utilization
   - Cardinality discipline: no per-user, per-request-id, per-URL-path labels
4. **Tracing.**
   - Trace context propagated across all service-to-service calls (headers, message attributes)
   - Spans cover external calls (DB, cache, third-party APIs), not just inbound handlers
   - Sampling rate sane (1-10% for high-volume, 100% for low-volume) and consistent across services
5. **Dashboards.**
   - A "service overview" dashboard exists with the golden-signal panels
   - Each panel labels its query and target (SLO, capacity, error budget)
   - Panels show real ranges (last 24h, last 7d), not just "last 15m"
   - Annotations for deploys / config changes
6. **Alerts.**
   - Alerts derive from SLOs or saturation, not from "this number went up"
   - Each alert has: a runbook link, a severity, a paging policy
   - Burn-rate alerts for SLOs, not raw error-count thresholds
   - Alerts that have fired in the last 90 days but had no action: flag as candidates for removal
7. **SLO definitions.**
   - The service has explicit SLOs (or the team can articulate what "good" means)
   - The SLO has a measurement window and an error budget
   - SLI queries are committed to the repo or tracked alongside the dashboard
8. **Operator ergonomics.**
   - Logs and traces are joinable by request id
   - Dashboards link to runbooks and to the alert that prompted the visit
   - The on-call gets to a useful view in under 3 clicks from a page

## Checks

- Cloud-managed observability (Datadog, New Relic, GCP Ops) reduces wiring burden but does not remove the need for emission discipline
- "We have logs" without structure or correlation is not coverage — flag it
- Alerts that never fire are as suspicious as alerts that fire constantly
- Respect the team's chosen vendor — do not insist on a specific stack

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Service`, `Logging`, `Metrics`, `Tracing`, `SLOs defined?`, `Alerts active`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Logging quality
   - Metric coverage and cardinality
   - Tracing coverage and propagation
   - Dashboards
   - Alerts and SLOs
   - Operator ergonomics
4. **Open questions / assumptions** — vendor, retention, SLO targets, alert ownership
5. **Residual risk** — anything that depends on the vendor configuration or off-repo dashboards
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- File paths + line numbers for emission sites (log calls, metric registrations, trace start)
- Metric names and label sets verbatim
- Dashboard names and URLs when referenced
- Alert rule names, queries, severity, and runbook links
- SLO definitions and SLI queries
