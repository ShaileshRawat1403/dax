# DAX 2.0.1 source validation

Binary/tag source **fe911e57415dcfa9d101bd2584b28d2ea3c84694** includes reviewed
Claude OAuth retirement and bounded Windows ledger lock hardening. Preparation
changes only the DAX package/workspace lock version and release documentation;
resolved dependencies are unchanged and frozen install passes.

[Exact-source CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37788614213)
passed Ubuntu, macOS and Windows. A fresh shared-object clone at the same source
with a **private local-only v2.0.1 tag**, frozen install, isolated test home/XDG,
Bun 1.4.0 and Node 4GiB heap passed `DAX_RELEASE=1 bun run release:gates`:
2,407 tests, zero failures and no macOS skips, plus typechecks, lint, 5/5 smoke
evaluations, Rust format/clippy/tests, repository guards and release checks.
`tagged-provenance.json` retains source/tag/package agreement. This private tag
is not a publication; the primary repository still awaits authorized integration,
main CI and public tag/release workflow.

The earlier untagged attempt passed tests/Rust checks but correctly failed the
release provenance guard. It is retained; no guard was relaxed. Bounded review
accepted the exact preparation source and its included changes. Windows operation/
handle causes from prior intermittent AccessDenied and compiled-probe EBUSY remain
unidentified; this is not an error-free claim. AGY latency is unchanged. Public
2.0.0, current local installation, user credentials/state and Verb remain unchanged
until the authorized publication/install steps complete. Cleanup remains last.

SHA-256 values cover **decompressed** bytes.

| Log | SHA-256 |
| --- | --- |
| `untagged-release-guard.gz` | `252f995993e1634ba5de9a28007b7c8f27081013e7be98870ce4a7a3a353d1d7` |
| `frozen-install.gz` | `b61028f27034be6d0109ef97bb10da4f359119a119900dfbbe70fd99b5f773c7` |
| `tagged-clone.gz` | `86d4c01a53344793b4a86bc0f8b844fec324a92eb39057469dba00ff9356c19a` |
| `tagged-frozen-install.gz` | `6fa8b3c0b9c702c5de889716f47137fb0c661b94f761cc35e4a9d7d89b2e0ce5` |
| `tagged-gates.gz` | `7e1aee6a74ba01b6f7ff324f4bf0ee265558e111cdf0870ce4245204f582356f` |
