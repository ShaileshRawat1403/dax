# Project-memory HTTP retention retry

Base: `b4795c0c27aa31bbcb1c9997e8a4b4a5fee8c128`.
Codex solo validation; no independent review claim.

The protected HTTP review endpoint previously returned conflict when an operator
retried an already-published approval after its source run was removed. The
project journal correctly preserved authority, but the endpoint consulted the
missing run before recognizing publication.

After candidate integrity and exact digest/actor validation, it now recognizes
an exact committed project event as a publication retry. Approved retries return
the same event; a conflicting rejection fails without journal mutation. No new
approval is created, and an uncommitted candidate still requires its source-run
decision. The project journal remains the only authority for published facts.

The real HTTP regression failed on the base (409 instead of 200), then passed
with the correction. Focused producer/consumer and journal tests: 16 passed,
zero failed, 89 assertions. Full Bun 1.4.0 release gates passed: 2,357 passed, two skipped, zero
failed, 8,977 assertions, with typecheck, lint, smoke, Rust, integrity and
release checks green. Exact-commit hosted CI remains required. [Retained evidence](evidence/project-memory-retention/README.md).

No additional gap closure, main integration, release, or installed binary change.
