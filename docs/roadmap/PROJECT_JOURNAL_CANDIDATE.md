# Project journal candidate (not an accepted gap closure)

Branch: `feat/project-scoped-journal`, based on `5a5ebe10dafb8c7c7293e3648f280f3a6e6acb04`.
This is Tier 2 state-authority work for the final independent review. It does not
merge into `main`, publish a release, or close `scope.project-journal`.

## Boundary

The project journal owns promoted, superseded, and retired facts. Its storage
protocol is the same `Journal` implementation used by run events, under a
separate project lock. The first approved transition and project genesis publish
atomically. A denied first change creates no project journal. Replay uses the
project log alone, so deleting a cited source run does not delete project truth;
the source reference remains an identifier, not reconstructable source content.

Every fact change requires a unique command ID and a source citation to a
canonical run approval resolution. The cited request must carry a digest-bound
`project_fact_change` subject for the same project, command, action, and exact
payload. The resolution must be approved by a named actor. Validation occurs
under the project lock before persistence. The run event retains only the
digest and opaque subject metadata, not a text preview or a second copy of the
project fact. A digest is a commitment, not encryption or recoverable text.

This is a trusted storage boundary, not yet an operator-facing promotion flow.
Production PM reads and writes still use their existing SQLite path; no model
or existing tool gains promotion authority from this journal API. `scope.project-journal`
and `memory.no-producer` remain open. Historical project memory is not silently
migrated or declared covered.

## Focused evidence and limitations

- Bun 1.4.0: `bun test packages/dax/src/state/events/journal.test.ts packages/dax/src/state/events/project-journal.test.ts` — 13 passed, 0 failed.
- Bun 1.4.0: `bun run --cwd packages/dax typecheck` and `bun run --cwd packages/dax lint` — passed.
- `git diff --check` — passed.
- Negative controls: denied first promotion leaves an absent journal; rejected
  approval, edited content, missing source, duplicate command, conflicting
  transition, malformed owner/sequence, and failed publication do not publish
  a fact. A killed child publisher leaves the prior journal readable and
  retryable.
- Full-suite validation is **not established**. An initial run without an
  isolated home hit sandbox `EPERM` and was stopped. The isolated sandbox run
  reported 1,949 passed, 2 skipped, 97 failed, and 1 import error; most failures
  involve sandbox-denied `/var/tmp`, local listener, or other host access, and
  the `scope.journal-primitive` inverted gap check is red because the shared
  implementation now exists. No broad pass claim is made from this run.
- Cross-platform CI, production operator review, PM read/write migration,
  historical coverage, and OS-kill recovery of the full DAX process remain
  unverified at this checkpoint.
