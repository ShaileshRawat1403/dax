# Project journal candidate (not an accepted gap closure)

Branch: `feat/project-scoped-journal`, based on `5a5ebe10dafb8c7c7293e3648f280f3a6e6acb04`.
This is Tier 2 state-authority work for the final independent review. It does not
merge into `main`, publish a release, or close `scope.project-journal`.
The branch removes `scope.journal-primitive` from its candidate ledger and turns
the shared-protocol check into an ordinary regression. This is a proposed
closure only: `main` still records eight open gaps until final review and
integration.

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

- Bun 1.4.0: `bun test packages/dax/src/conformance/scope-authority.test.ts packages/dax/src/state/events/journal.test.ts packages/dax/src/state/events/project-journal.test.ts` — 20 passed, 0 failed, 89 assertions.
- Bun 1.4.0: `bun run --cwd packages/dax typecheck` and `bun run --cwd packages/dax lint` — passed.
- Bun 1.4.0: full `release:gates` with isolated test/XDG state — 2,053 passed,
  2 skipped, 0 failed; typechecks, lint, smoke evaluations, Rust checks, and
  release checks passed. The local raw log is retained at
  `/private/tmp/dax-project-journal-gates.KpVKAj/gates.log` for this host.
- `git diff --check` — passed.
- Negative controls: denied first promotion leaves an absent journal; rejected
  approval, edited content, missing source, duplicate command, conflicting
  transition, malformed owner/sequence, and failed publication do not publish
  a fact. A killed child publisher leaves the prior journal readable and
  retryable.
- Before the successful host-access run, an initial run without an isolated home
  hit sandbox `EPERM` and was stopped. An isolated sandbox run reported 1,949
  passed, 2 skipped, 97 failed, and 1 import error, including host-access
  denials and the stale inverted journal-primitive check. Those failed attempts
  remain part of the record; they are not presented as product regressions.
- Cross-platform CI, production operator review, PM read/write migration,
  historical coverage, and OS-kill recovery of the full DAX process remain
  unverified at this checkpoint.
