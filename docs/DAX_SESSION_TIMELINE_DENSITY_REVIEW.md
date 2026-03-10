# DAX Session Timeline Density Review

## Purpose

Validate the first CLI timeline surface against real sessions before adding a workstation timeline surface or expanding the model.

This review checks whether `dax session timeline <session-id>` currently answers the operator question:

> What happened in this session, in what order, and what changed state or trust?

## Sessions Reviewed

Representative sessions inspected from the canonical store:

- `ses_329e9e401ffesgr7lt3bwZxj5z`
- `ses_32a18961dffe6EB7pyv1b4k2Lw`
- `ses_32d662276ffervMwsjjDxy68o2`
- `ses_32dd2841cffe1GhaMiDHsYhbmc`
- `ses_32de031a7ffenstrqJdZRD2Szl`
- `ses_32ddd10fbffe6xBlnTvYtoTxF3`

The most important stress case was `ses_32ddd10fbffe6xBlnTvYtoTxF3`, which had:

- 91 messages
- 28 diffs
- 93 ledger entries
- only 9 visible timeline rows in the current surface

## What Works

- The timeline is not a raw ledger dump.
- The output is readable in chronological form.
- Artifact production is visible and easy to correlate with the end of a session.
- The separation between timeline and transcript remains intact.
- Simple sessions render cleanly without extra noise.

## Main Findings

### 1. Long sessions are too sparse

In rich sessions, the current surface often collapses to:

- session created
- execution started
- repeated artifact produced entries

This is not enough to reconstruct meaningful progression for a long work lifecycle.

### 2. Artifact events dominate the visible timeline

In the heaviest reviewed session, most visible entries were artifact rows derived from tool-output retention or final diff output.

This makes the timeline feel closer to:

- output inventory

than to:

- session progression

### 3. Many meaningful ledger events are currently invisible

The reviewed heavy session had 93 ledger events, mostly `audit` entries with permission/action data such as:

- `bash allow`
- `edit allow`
- `read allow`
- `external_directory ask`
- `external_directory allow`

The current surface only promotes a narrow subset of these into visible timeline rows. That keeps noise down, but it currently hides too much mid-session structure.

### 4. Approval resolution is visible, but approval progression is still weak

When approval or override signals exist, they appear correctly as governance events. But across real sessions, the visible progression still does not reliably explain:

- what triggered operator intervention
- whether the intervention changed execution direction
- whether the session resumed or degraded afterward

### 5. Artifact references are too implementation-shaped

Some artifact references point to long local tool-output paths such as:

- `../../../../../ananyalayek/.local/share/dax/tool-output/...`

That is correct technically, but poor operator language. These references are inspectable, yet they are not product-shaped.

### 6. Trust progression is underrepresented

The current surface can show trust posture changes when audit rows carry explicit run status. In practice, many sessions expose approval and governance history without a matching visible trust progression event.

That makes the timeline weaker as a bridge between:

- session history
- trust posture
- future verification exposure

## Density Conclusions

The v1 timeline is:

- readable
- structured
- safe

But it is not yet dense enough to explain rich sessions.

The main issue is not excess noise.
The main issue is that the current selection logic is too conservative in the middle of the session and too permissive around artifact output.

## Recommended Refinements

### 1. Promote more progression-shaped event families

Prefer visible events such as:

- step or phase transition
- first governance escalation in a sequence
- approval outcome that changes execution
- first meaningful artifact in a cluster
- trust posture transition

Avoid showing every low-level allow event individually.

### 2. Collapse repeated artifact rows

When multiple artifacts come from repeated tool-output attempts in a short window, summarize them as a grouped progression event rather than listing each one independently.

Example direction:

- `3 lint-fix outputs produced during remediation`

instead of several near-duplicate artifact lines.

### 3. Add progression summaries for repeated governance activity

Audit/permission rows are currently too low-level to expose directly one-by-one, but they contain meaningful structure.

Promote grouped summaries such as:

- `Execution entered remediation loop`
- `External directory access required review`
- `Repeated edit and lint actions completed under allow policy`

### 4. Shorten references into operator-facing labels

Prefer:

- file labels
- artifact names
- audit run ids
- concise output handles

Avoid long filesystem-heavy path references in the visible timeline.

### 5. Make trust changes rarer but more meaningful

Trust posture rows should be visible when:

- blockers appear
- warnings first appear
- overrides degrade posture
- verification later improves posture

Do not emit a posture row unless the visible operator meaning actually changes.

## Model Impact

The underlying timeline model still looks correct.

No foundational model rewrite is required.

The main required changes are:

- better event selection
- better grouping
- better operator wording
- cleaner references

This is a surface-density problem, not a session-model or trust-model problem.

## Recommended Next Step

Use this review as the input to a narrow CLI refinement pass before any workstation timeline integration.

The next implementation slice should focus on:

- density rules
- grouping rules
- wording cleanup
- operator-shaped references

It should not yet add:

- replay
- release readiness
- cross-session history
- workstation timeline UI
