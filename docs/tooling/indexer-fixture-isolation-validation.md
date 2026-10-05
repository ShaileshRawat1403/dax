# Indexer fixture isolation correction

Base: `80283a5a0b14bb9ab535d883155fcc633e1a749a`. Codex sole validation.
Only Rust test-fixture construction and cleanup change; ranking production code
and its original assertions remain unchanged. No dependency/lockfile change.

Convention CI [37306440743](https://github.com/ShaileshRawat1403/dax/actions/runs/37306440743)
passed Ubuntu but failed macOS's unchanged `scores_relevant_files` Rust test:
`storage.ts` ranked before `approval.ts`. Windows was cancelled by fail-fast.
The log does not include fixture paths/timestamps, so its exact cause remains
unestablished. No blind rerun is used as evidence of correction.

The old fixture reused `create_dir_all` under a timestamp-only root. A controlled
same-tick test holds a second fixture in the real truncate-before-write window.
On that code it reproduces the observed wrong ranking; on the correction the
first fixture remains intact. Timestamp precision alone is not directory ownership.

Roots are now atomically reserved using process ID, timestamp and an atomic
sequence; an existing root is never reused. RAII cleanup deletes only the owned
root and is strict. Five crate tests pass, including 16 concurrent same-tick
fixtures with distinct paths and successful removal. The original scoring,
structural-index and cache assertions are preserved.

[Retained failure and control logs](evidence/indexer-fixture-isolation/README.md).
Full Bun 1.4.0 gates passed: 2358 passed, 2 skipped,
0 failed, 8991 assertions; typecheck, lint, smoke, Rust,
integrity and release checks passed. Exact-commit hosted CI remains required. No merge, release,
installed-binary change, aggregate closure, or assertion weakening.
