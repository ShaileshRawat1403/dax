# Shared journal primitive — candidate foundation

Branch: `feat/scoped-journal-primitive`
Base: `b2e99549819a42c6abe71d5f4ebb0ef720a79daa`
Status: implementation candidate, not integrated or independently reviewed.

The run journal now uses `state/events/journal.ts` for locking, contiguous
sequence and unique-event validation, compare-and-swap and tail appends,
duplicate-command handling, atomic publication, and read/replay refusal. Its
existing storage path, v1 envelope, initialization recovery, and public API are
preserved. A project-shaped test owner exercises the same primitive, but no
production project journal exists yet. `scope.journal-primitive` therefore stays
open, as do the other seven aggregate gaps.

## Local validation on Bun 1.4.0

- Focused journal, run-integrity, and scope tests: 18 passed, 0 failed, 95
  assertions. Retained output:
  `artifacts/validation/scoped-journal-20260929/focused.log`.
- Full `bun run release:gates`: 2,041 passed, 2 skipped, 0 failed; smoke,
  typecheck, lint, Rust, and release checks passed. Retained output:
  `artifacts/validation/scoped-journal-20260929/gates-corrected.log`.
- The first full run had 2,040 passed, 2 skipped, 1 failed because the old
  inverted conformance check treated the appearance of `journal.ts` as complete
  two-scope coverage. That check and the ledger description were corrected
  without closing the gap. Its retained log is
  `artifacts/validation/scoped-journal-20260929/gates.log`.
- `git diff --check` passed.

These are solo checks, not Astra's independent validation. Exact-SHA platform
CI is still required. No tag, release, or frozen v1.5.0 evidence was changed.

## Remaining proof

The project journal must instantiate this primitive and independently replay
its own authority. Scope-aware envelopes and provenance references need a
historical-run compatibility policy. Process interruption after temporary write
is represented by an unpublished temp-file control; an OS process-kill test is
not yet claimed.
