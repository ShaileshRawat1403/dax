# Approved project memory consumption

Base: `62c91d4b7bd15f6d19a65912378354b4fccd21ab`.
Codex sole implementation and validation; no independent review claimed.

Fresh production intent interpretation now reads active memory facts from the
project journal through `PM.approved_memory`. Superseded and retired facts cannot
enter new-session context. Read/schema errors propagate before the optional
intent-model handler or provider dispatch. A missing journal reports unavailable
coverage; legacy SQLite rows are retained for historical API compatibility and
are not inferred to be operator-approved facts. No migration auto-promotes them.

The reader is independent of SQLite and current-instance state: explicit project
IDs address only that journal, with storage-key and envelope ownership checks.
Projection returns the journal revision and source references, and orders by
promotion sequence. Replay does not need the original run store after promotion.

Controls: eight project-journal tests passed, 38 assertions, covering promotion,
supersession, retirement, restart, removed source runs and malformed authority.
The initial corruption fixture wrote an adjacent file instead of the journal;
its failed expectation is retained as a fixture error, not a production defect.
The corrected fixture targets the actual journal and verifies rejection.
Complete Bun 1.4.0 release gates passed; retained raw logs contain the exact test
counts and all typecheck, lint, smoke, Rust and release results.

[Durable logs and checksums](evidence/project-memory-reader/README.md).

No claim of project-journal or memory gap closure: operator candidate/review/
promotion production entry points and full lifecycle acceptance still remain.
Historical PM preferences/constraints and legacy APIs have not been migrated.
No merge, release, installed-binary replacement or frozen-evidence edit.
