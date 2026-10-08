# Final DAX 2.0.0 release checkpoint

Receipt finalized 2026-10-08. Runtime and intended tag source:
**`4d03493e94e7a8f6f78383bc44c9e610a861035e`** on
`release/2.0.0-candidate`. This supersedes c064124 and 2a75a43 prepared
sources. This later documentation receipt is not the binary source. Main
integration, post-merge CI and publication remain pending.

## Verified preparation

- [Exact-source CI 37656018792](https://github.com/ShaileshRawat1403/dax/actions/runs/37656018792)
  passed Ubuntu, macOS and Windows on its first attempt.
- Fresh frozen Bun 1.4.0 dependencies, clean independent validation clone and
  clone-only v2.0.0 tag: **DAX_RELEASE=1 release:gates** passed **2,399 tests,
  2 skips, 0 failures**, all five cold workspace typechecks, lint, 5/5 smoke
  evaluations, Rust fmt/clippy/tests, integrity and release checks.
- Eleven archives were built with publishing disabled. Archive hashes match the
  manifest; main binary members match their corresponding build outputs. A real
  installer using owned fixture downloads reports 2.0.0 and its installed Rust
  core emits a proof. Corrupted checksums preserve the prior dummy installation.
- Prepared bytes are preserved in the owned dax-patched-deps-validation checkout
  at `artifacts/release-2.0.0-4d03493/`. [Durable logs, inventory, checksums,
  installer and tagged provenance](evidence/release-2.0.0/mcp-fixture/README.md)
  retain unsuccessful attempts too. No public tag or installed binary changed.

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
download before any installed-binary replacement. AGENTS.md reserves main merging
for the maintainer. Clean up only fully incorporated clean branches/worktrees;
preserve dirty/unmerged checkouts, user configuration and needed ignored evidence.

v1.5.0 and its assets remain unchanged. Main still has eight accepted open gaps
until integration. The operator binary retains SHA-256
`5671509d2f18e6d8316fee9bd7df34be96dd409ed628e9b6f5541d1b4e159fb0`.
