---
name: "incident-runbook"
description: "Generate or audit an incident runbook for an alert/service from code, dashboards, and alert rules. Output is a runbook plus a findings table of gaps. Findings follow the shared output contract."
---

# Incident Runbook

Use this skill when the task is to produce a usable runbook (or to audit an existing one). The bar is that a sleepy on-call engineer can resolve or escalate the alert in under five minutes by following the runbook alone.

## Use when

- a new alert is about to fire in production
- on-call is paging on something that has no runbook
- a postmortem flagged "no runbook" as a contributing factor
- a runbook exists but goes stale — last updated more than 6 months ago, or the named systems have moved

## Workflow

1. **Identify the alert or scenario.** Get the alert rule, threshold, severity, and what dashboards or signals trigger it. If auditing an existing runbook, read it first and note what's already there.
2. **Confirm impact.** What does this alert *actually* mean for users? "p99 latency above 500ms" is not impact; "checkout completion drops by 5%" is.
3. **Locate the system.** Repo, service, deploy environment, dashboards, on-call rotation, owning team.
4. **Diagnostic ladder.** Order the checks from cheapest to most invasive:
   - Is the alert real? (compare against the dashboard, check for noisy thresholds)
   - Is upstream healthy? (dependencies, network, cloud provider status)
   - Is the deploy recent? (look at deploy markers and changelog)
   - Is there a known issue? (incidents channel, status page)
   - What does the log say for the affected request id / trace?
5. **Mitigation options.** List in order of safety:
   - No-action: ack and watch (when?)
   - Rollback the last deploy
   - Flip a feature flag or kill switch
   - Scale up
   - Restart
   - Failover to a healthy region/replica
   - Drain traffic
6. **Escalation path.** Who to page next, when, with what context. Include the data the next person will ask for.
7. **Post-mitigation.** What to capture for the postmortem (timeline, logs, dashboard snapshots, customer impact estimate).
8. **Maintenance.** Add a "last reviewed" date and a trigger for re-review (deploy of the owning service, SLO change, alert threshold change).

## Runbook structure to produce

```
# Runbook: <Alert or Scenario>

Severity: <P1 | P2 | P3>
Owners: <team / rotation>
Dashboards: <links>
Last reviewed: YYYY-MM-DD

## What this means
<one paragraph on real-world impact>

## First five minutes
1. <cheap check>
2. <cheap check>
3. <cheap check>

## Diagnostic ladder
| Check | How | What it tells you |
| ... | ... | ... |

## Mitigation
| Option | When to use | Risk |
| ... | ... | ... |

## Escalation
- After N minutes with no progress: page <next>
- Bring: <context they will need>

## Postmortem capture
- Timeline
- Affected requests / users
- Logs and traces to preserve
```

## Checks

- A runbook is not a code dump — link to dashboards and code rather than pasting them
- Every link should still resolve; flag dead links
- The runbook must name *people* or *rotations*, not "the team will handle it"
- Avoid prescribing mitigations that require write access most on-callers don't have
- Date the runbook — undated runbooks are presumed stale

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

When generating a runbook, return:

1. **The runbook itself** in the structure above
2. **Gaps** — a table of information that was missing and had to be assumed or marked TODO
3. **Open questions** — items only the owning team can resolve

When auditing an existing runbook, return:

1. **Verdict** — `usable as-is` / `usable with fixes` / `rewrite`
2. **Counts** — Critical/High/Medium/Low/Info
3. **Findings** — one table per category:
   - Impact framing
   - Diagnostic ladder
   - Mitigation safety and accessibility
   - Escalation specificity
   - Link freshness and date
4. **Open questions / assumptions**
5. **Next actions**

## Evidence to collect

- Alert rule name, threshold, severity verbatim
- Dashboard URLs and panel names
- Service repo path and the owning team identifier
- Deploy marker source (release workflow, git tag, deploy log)
- Existing runbook path and last-modified date if auditing
