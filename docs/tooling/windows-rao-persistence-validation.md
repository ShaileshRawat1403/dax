# Windows RAO composite persistence budget

Base: `c2d79b20a2f1fa50ce3093d307c509df258ef9c5`.
Test-only correction; production persistence and filtering remain unchanged.

## Evidence and correction

[CI 37449707328](https://github.com/ShaileshRawat1403/dax/actions/runs/37449707328)
failed the unchanged Windows `session and type filters compose` test after
14,004.91 ms against its default 5,000 ms budget. This establishes a deadline
failure, not the cause of the slow persistence operation. SQLite has a configured
5,000 ms busy timeout and the fixture performs three awaited writes and a query
with authority filesystem reads; the composite test now has a bounded 30,000 ms
budget and records each phase's duration. No retry, skip, reduced write population,
or filtering assertion change was introduced. Formatting changes are incidental.
The underlying intermittent latency remains unexplained and is not claimed fixed.

Bun 1.4.0 focused controls: **16 passed, 0 failed**. Final full release gates:
**2,377 passed, 2 skipped, 0 failed**, plus typechecks, lint, smoke, Rust and release
checks. Local phase durations were approximately zero milliseconds; that does not
explain Windows latency. Manifest and lockfile are unchanged. Exact-SHA hosted CI
is required before integration. Solo validation is not independent review.

The preceding compiled-path checkpoint passed
[all-platform CI 37451990396](https://github.com/ShaileshRawat1403/dax/actions/runs/37451990396).
No merge, release or accepted gap closure is performed by this correction.

## Retained evidence

Hashes cover decompressed bytes. Files are under `evidence/`.

| Log | SHA-256 |
| --- | --- |
| `rao-windows-red.log.gz` | `dd4b4422edec0a1c68af7927f3f05a8957d4a1bd8d357b62fda0ca2c9654fe60` |
| `rao-budget-focused.log.gz` | `7ae41a36a7ebcfaf243507599b86bed467c33e51c21949986ab8b298edb7bda1` |
| `rao-budget-gates.log.gz` | `0537d30c7bb67ba9081e71514ef25593bf09e3e6a81112466fcca717155b3ef3` |
