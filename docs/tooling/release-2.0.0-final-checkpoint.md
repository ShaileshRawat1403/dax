# Final DAX 2.0.0 release checkpoint

## Publication completed — 2026-10-08

[v2.0.0](https://github.com/ShaileshRawat1403/dax/releases/tag/v2.0.0) is published
at 87029cbd57dd16c330f677b8cc699c3404ecd45f. Main CI 37717923118 and release
CI 37718917919 passed. All eleven actual downloaded archives match published
checksums; the disposable installer reports 2.0.0. [Published evidence](evidence/release-2.0.0/published/README.md)
records the final bytes. Earlier preparation/action sections below are historical.

Receipt finalized 2026-10-08. Runtime and intended tag source:
**`87029cbd57dd16c330f677b8cc699c3404ecd45f`** on
`release/2.0.0-candidate`. This supersedes c064124,2a75a43 and4d03493 prepared
sources. This later documentation receipt is not the binary source. Main
integration, post-merge CI and publication remain pending.

## Verified preparation

- [Exact-source CI 37716643300](https://github.com/ShaileshRawat1403/dax/actions/runs/37716643300)
  passed Ubuntu, macOS and Windows on its first attempt.
- Fresh frozen Bun 1.4.0 dependencies, clean independent validation clone and
  clone-only v2.0.0 tag: **DAX_RELEASE=1 release:gates** passed **2,401 tests,
  zero skips, zero failures** (macOS), all five cold workspace typechecks, lint, 5/5 smoke
  evaluations, Rust fmt/clippy/tests, integrity and release checks.
- Eleven archives were built with publishing disabled. Archive hashes match the
  manifest; main binary members match their corresponding build outputs. A real
  installer using owned fixture downloads reports 2.0.0 and its installed Rust
  core emits a proof. Corrupted checksums preserve the prior dummy installation.
- Prepared bytes are preserved in the owned dax-patched-deps-validation checkout
  at `artifacts/release-2.0.0-87029cb/`. [Durable logs, inventory, checksums,
  installer and tagged provenance](evidence/release-2.0.0/session-fixtures/README.md)
  retain unsuccessful attempts too. No public tag or installed binary changed.

## Session collector coverage

The two ambient-history skips now execute against isolated persisted sessions,
reopened through the real CLI bootstrap. Exact identity, lifecycle, artifact and
timeline assertions and missing-record failures pass: 18 tests, 0 skips, 0 failures,
91 assertions. Production collectors are unchanged; setup errors are no longer
converted to a null skip. Existing platform-specific exclusions remain unchanged.

## Corrections and review boundary

The [operator credential, malformed-request and Windows CMD corrections](release-2.0.0-operator-env-validation.md)
were accepted at 2a75a43. The later test-only MCP fixture correction at 4d03493
is separately accepted: only project/storage setup gets a bounded 20s hook budget;
configuration, network and authority checks retain their 5s test deadline. Held
operations are observed immediately, released/drained in finally, and SDK methods
restored after settlement. A controlled 5.5s setup delay fails the baseline and
passes the correction; 16 prompt/resource controls pass with 55 assertions. The
underlying Windows setup-delay cause remains unestablished. No retries or skips
were added, and authority assertions remain enforced.

Reviews are bounded separate-agent reviews, not different-model-family validation
or a whole-stack independent security audit. The original sprint ledger is empty
within its documented scope. Unsupported reviewed plugin/local-MCP/worker/verifier
bindings remain blocked/backlog. Arbitrary same-user code and trusted plugins are
not OS-isolated. Rust sidecars remain build-host-only; cross-target sidecar coverage
and live IdP/provider behavior are not claimed. DAX is not claimed error-free.

## Remaining maintainer actions

Follow the [publication handoff](release-2.0.0-publication-handoff.md): fast-forward
main to the final receipt, require exact-main platform CI, then publish v2.0.0 at
the runtime SHA above. Verify the actual published inventory and disposable
download before any installed-binary replacement. The maintainer explicitly authorized Codex to integrate and publish this release
on 2026-10-08. Clean up only fully incorporated clean branches/worktrees;
preserve dirty/unmerged checkouts, user configuration and needed ignored evidence.

v1.5.0 and its assets remain unchanged. Main retains its prior ledger until integration. The operator binary retains SHA-256
`5671509d2f18e6d8316fee9bd7df34be96dd409ed628e9b6f5541d1b4e159fb0`.
