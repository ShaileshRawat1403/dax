# Stage 4d reviewed creation correction

Implementer: GPT-6.1 Sol. Reviewer: Astra. Source base:
`f2484a2f6131494d82a734b9e2326496e673f2c2` (accepted bounded D1).
This is a bounded D2 prerequisite; it exposes no operator routes and closes no
aggregate conformance gap.

Astra reproduced a real factory crash before the first review request: the birth
and queue existed, but deleting the private reservation allowed a direct action
into compatibility dispatch. Its unmodified independent test and red baseline
are retained under `artifacts/validation/conformance-closeout/` as
`dax-astra-d2-reservation-control.txt` and
`dax-astra-d2-reservation-baseline.log` (zero passing, one failing, six assertions).

Creation now allocates an ID and compiles first, establishes canonical birth and
queue with optional literal `grantReviewIntent: "reviewed_grants"`, reserves the
private review, and creates the session with its governing reference at birth.
The initialization recipe precedes genesis append, so a failed append is still
reviewed intent and has no publicly usable session. Normalization and exact retry
comparison preserve the field; reviewed birth/recipe disagreement refuses reads
and appends. Intent grants no capabilities, publication or executable authority.

Review presence recognizes birth, journal review history, or positive recipe
evidence. With an empty journal, malformed/unreadable marker is uncertainty and
refuses. With a strictly parsed, replayable non-review journal, only marker-read
failure retains the previously approved legacy isolation; a readable recipe
containing any supplied review-intent value is presence, including malformed
intent. The catch surrounds only marker reading, never journal parsing or replay.
No repair, lock or append occurs during presence inspection.

The reducer refuses `execution_started` and `workflow_started` before activation
for marked or review-history runs. Both event types now undergo replay validation
before append, so refused starts leave the durable journal intact.

The narrow compatibility amendment, explicitly approved by Astra, changes lookup
for an ordinary v1 artifact with **empty journal plus malformed/unreadable marker**:
the artifact remains intact but cannot itself prove governing authority. The
existing malformed-marker test still requires the write to be refused, compares
unchanged raw v1 bytes via Storage, and now also requires getter refusal. The
original contradictory assertion failure is retained. Actual absent markers,
valid ordinary/legacy markers, and readable non-review history keep their behavior.

The new fault controls inject failures only at creation boundaries; no authority,
compiled-image, provider or dispatch gate is replaced. They cover lost reservation
across direct action, guardian, native begin, all four SessionPrompt entries;
zero successor effects and unchanged journal; genesis interruption; session
publication order; intent retry/schema/recipe disagreement; birth-only erasure;
malformed positive recipe; ordinary/historical starts and marker isolation.
Genuine compiled producer acceptance remains the separate production-module suite.

Initial correction (`685eb38`) full pinned `release:gates` exited zero: **2,317 passed, zero failed, two
existing skips, 8,718 assertions across 284 files**, plus five smoke evaluations
and 79 Rust tests. Workspace typecheck/lint, repo/legacy guards, Rust fmt/clippy
and release checks passed. The full suite re-ran the genuine 41-control compiled
producer after the final recipe change. Focused controls passed 24 tests / 138
assertions across three files. The artifact `d2-reservation-evidence.json` pins
source bytes and log/archive checksums; `d2-reservation-raw-logs.tar.gz` retains
the raw evidence. Exact-SHA independent review and three-platform CI remain
pending at commit publication.

Validation receipts and archived raw logs accompany this checkpoint. Failed
attempts remain evidence: the original compatibility assertion; missing fixture
config directory and schema-test misuse; a test executor enum typo; the additional
promise matcher exceeding the old lint suppression count. A second full gate
attempt was deliberately stopped before source changes for Astra's added positive
recipe control and is not acceptance evidence.

The unchanged D1 independent review document is copied byte-for-byte from Astra's
`aa6801287399add064172a298ede5f63188cfcb2`, with its independent logs/controls and
three-platform CI receipt retained. D1's accepted exact SHA remains unchanged.

After exact-SHA review of this correction, the next slice is the previously
approved restricted generic creation/review/revision/start operator API, with
strict preflight, complete expected pins under owner locks, and a durable initial
dispatch claim. D3 MCP/ask/delegation, D4 session activity presentation and C2–C5
remain pending. No main merge, activation, release or installed binary change.

## Corrective review finding at 685eb38

Astra independently passed the original reservation/source/compiled/legacy
matrix at `685eb38adf17e3b36bacc4e2d1bc674f414ffab1` (21 tests / 130 assertions,
including the 41 compiled controls), then found a Medium integrity inconsistency:
an empty journal marker labeled `legacy` with a supplied reviewed initialization
recipe returned ordinary absence. This is contradictory stored metadata, not an
established normal producer crash or protection against rewriting every trusted
storage object. The independent extra baseline (ten passing, one failing, 55
assertions, including historical cutover controls) and appended source are retained
separately as `dax-astra-d2-legacy-intent-baseline.log` and
`dax-astra-d2-legacy-intent-control.txt`.

The empty-journal legacy branch now treats any supplied review-intent value as
presence, including malformed values. Genuine legacy markers without review
intent retain absence. New literal/malformed controls require getter and direct
action refusal, zero successor effects, unchanged marker and unchanged empty
journal. No grant or executable authority is inferred from the contradictory
recipe. The exact corrective receipt and raw gate log accompany the successor
commit; its independent review and CI remain required before D2 exposure.


Corrective full pinned `release:gates` exited zero: **2,318 passed, zero
failed, two existing skips, 8,731 assertions across 284 files**, including the
41 compiled controls, five smoke evaluations and 79 Rust tests. The receipt
`d2-reservation-legacy-evidence.json` pins current source bytes and raw log
checksums; `d2-reservation-legacy-raw-logs.tar.gz` preserves corrective validation
and the independent red baseline. Operator exposure is still held for review.
