---
name: "deploy-readiness"
description: "Production readiness audit for a service: health checks, rollback strategy, runbook presence, observability wiring, capacity, dependencies. Returns impact-ordered findings tables."
---

# Deploy Readiness

Use this skill when the task is to decide whether a service is safe to put in front of real traffic. Distinct from [release-readiness](../release-readiness/SKILL.md) (which asks "is this version shippable?") and [release-pipeline-audit](../release-pipeline-audit/SKILL.md) (which asks "is the build/release pipeline trustworthy?"). This skill asks: once it's shipped, will it survive contact with production?

## Use when

- a service is about to go to production for the first time
- a service is being moved to a new environment (region, cluster, cloud)
- a postmortem found that the service was not ready and the question is which gaps to close
- a new on-call team is taking ownership

## Workflow

1. **Identify the service.** Confirm the service boundary: which deployable unit is being audited, where it runs, who owns it, what its SLOs are (or whether SLOs even exist).
2. **Health checks.**
   - Liveness probe (or equivalent): a real check, not a constant `200 OK`. Flag handlers that return success without exercising the service.
   - Readiness probe: blocks traffic until dependencies are reachable. Flag readiness handlers that signal ready before warm-up is complete.
   - Startup probe (for slow-start services): present when needed.
3. **Configuration management.**
   - Config comes from environment / config map / secret store, not from in-image defaults.
   - Secrets come from a real secret store, not from env vars baked into the image.
   - Required config has explicit validation at startup — fail fast with a clear message.
4. **Resource sizing.**
   - CPU and memory limits set and justified (not the default).
   - Horizontal scaling rules defined (HPA, fleet autoscaler, or documented manual scaling).
   - Single-replica services flagged unless explicitly justified.
5. **Dependency declarations.**
   - Every external dependency (DB, cache, queue, third-party API) declared with timeout, retry, and circuit-breaker policy.
   - Timeouts shorter than the upstream caller's timeout — flag inverted timeout chains.
6. **Observability wiring.**
   - Logs structured, with a request/trace id.
   - Metrics for the four golden signals (rate, errors, duration, saturation) emitted at minimum.
   - Traces propagated across service boundaries.
   - Refer to [observability-audit](../observability-audit/SKILL.md) for the deep observability pass.
7. **Rollback strategy.**
   - Documented rollback procedure (re-deploy previous artifact, feature flag flip, traffic split).
   - Database migrations reversible or paired with rollback migrations — refer to [db-migration-review](../db-migration-review/SKILL.md) for schema work.
   - Feature flags or kill switches for new functionality.
8. **Runbook presence.**
   - A runbook exists for the top 3 alerts the service will fire.
   - The runbook references real dashboards and log queries, not placeholders.
   - Refer to [incident-runbook](../incident-runbook/SKILL.md) for the runbook quality pass.
9. **Graceful shutdown.**
   - Service traps SIGTERM and finishes in-flight requests.
   - Drain timeout set, and shorter than the platform's kill-after timeout.
10. **Data lifecycle.**
    - Backup strategy for any stateful data the service owns.
    - Retention policy documented.
    - GDPR/PII obligations identified if user data is touched.
11. **On-call coverage.**
    - The service has an on-call rotation defined, not "ask the author."
    - Paging policy matches severity definitions.

## Checks

- Distinguish "missing entirely" (High/Critical) from "present but weak" (Medium)
- A single-replica service is not automatically a finding — flag it only when the service is on the critical path
- Cloud-managed services (RDS, Pub/Sub, etc.) take some items off your plate — credit them
- Do not invent SLOs the team has not committed to; flag their absence instead

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Service`, `Environment`, `Owner`, `SLOs defined?`, `Runbook present?`, `On-call?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Health checks
   - Configuration and secrets
   - Resource sizing and scaling
   - Dependencies and timeouts
   - Observability wiring
   - Rollback and feature flags
   - Runbook and on-call
   - Graceful shutdown and data lifecycle
4. **Open questions / assumptions** — service ownership, SLOs, on-call, or scope items not in the repo
5. **Residual risk** — runtime-only checks the audit could not run (load test, chaos test, real-traffic validation)
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- File path + line for every flagged config / probe / handler
- The actual probe handler implementation (not just the path)
- Resource limit values verbatim (`cpu: 500m`, `memory: 1Gi`)
- Timeout / retry values for each declared dependency
- Runbook file paths, alert names, and dashboard URLs when referenced
