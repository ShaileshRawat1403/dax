# Local validation of bounded ledger hardening

Production lock handling was validated by the full Bun 1.4.0 `release:gates`
run at 27639a1c44c9088b0e1c71d4d3f9b59ee651a64b: 2,401 Bun tests,
zero skips/failures, smoke evaluations, typechecks, lint, Rust checks and release
checks passed. Subsequent changes replace Windows-only fixture assumptions,
add test-only failure-phase diagnostics, and retain evidence; they do not change
that production classifier. Local ledger tests and workspace clippy also pass
at 7d8460afd46f7c0bef2cb3a7c6a6636c0d064e4c. Windows-only controls require
exact-source hosted Windows evidence; local macOS cannot establish their results.

The CI failure that prompted this work remains an unlocated AccessDenied error.
Neither a passing concurrency test nor these fixture controls identifies its
original operation or handle. The published v2.0.0 tag excludes this follow-up.

SHA-256 values below cover **decompressed** log bytes.

| Log | SHA-256 |
| --- | --- |
| `local-release-gates.gz` | `f1ae2405cbb7bfad7733dc2d7ec69356e2df15747d27186d6bdaa6daa700af1a` |
| `local-ledger-tests.gz` | `2651eeab96f6c49ff9b8e88f70fe6aa8b71deb5e40bf4f2d7a9fe35c1445373e` |
| `local-clippy.gz` | `56c7d77e6f7bbbc5678f1c540728f44be7148485a096835549be626dea806aab` |
