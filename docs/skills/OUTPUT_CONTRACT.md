# Skill Output Contract

Every DAX skill that produces findings or audit output should follow this contract. It is referenced by skill `SKILL.md` files; updating this file updates the contract for all of them.

## Goals

- Operators can scan the output in one pass
- Severity, location, and impact are immediately visible
- Output stays stable across runs so receipts remain comparable

## Section order

1. **Verdict** — one line + a small key/value table (overall status, gates, environment)
2. **Findings** — grouped tables, one per category, **ordered by impact**
3. **Open questions / assumptions** — bullet list, only when there is genuine uncertainty
4. **Residual risk** — what was *not* checked or could not be verified
5. **Next actions** — concrete steps, in order

Omit sections that have nothing to say. Do not pad.

## Findings table format

Each category gets its own table. Required columns:

| Issue | Location | Severity |

- **Issue** — what the problem is, in one short noun phrase (not a sentence)
- **Location** — `file:line` for code, package name for dependencies, `command` for runtime issues
- **Severity** — one of `Critical`, `High`, `Medium`, `Low`, `Info`

Optional extra column allowed when it adds signal:

| Issue | Location | Severity | Recommendation |

## Ordering rules

Within a table:

1. **Critical first**, then High, Medium, Low, Info
2. Within the same severity, order by **blast radius** (production-reachable before dev-only)
3. Ties broken by file path alphabetically

## Severity definitions

| Severity | Definition |
|---|---|
| Critical | Exploitable now, in production code paths, with no compensating control |
| High | Exploitable with effort, or critical but behind a compensating control |
| Medium | Real risk but requires preconditions; or correctness bug with workaround |
| Low | Minor risk, code quality, or noise reduction |
| Info | Observation only — no action required |

Skills should justify any non-obvious severity in a one-line comment under the table.

## Counts

When the audit covers many items, include a summary count table before the findings:

| Severity | Count |
|---|---|
| Critical | _n_ |
| High | _n_ |
| Medium | _n_ |
| Low | _n_ |
| **Total** | _n_ |

## What not to do

- Do not use bullet lists where a table would carry the same information
- Do not prose-narrate findings that the table already states
- Do not invent severities outside the five defined above
- Do not summarize at the end — the verdict already does that

## Referencing this contract

Each skill's `SKILL.md` should include in its **Output contract** section:

> Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Resolve the relative path from the skill's own location.
