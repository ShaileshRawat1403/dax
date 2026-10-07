# Final 2.0.0 operator-environment correction

Runtime source: **`2a75a430f2891cb8fd861a4d39c2a4fc3f94eef1`** on
`release/2.0.0-candidate`. This supersedes the earlier c064124 artifact source.
Main integration and publication remain pending; v1.5.0 and the installed binary
are unchanged. This later documentation receipt is not the artifact source.

## Bounded fixes and controls

- Model ShellTool, operator shell and both command-snippet launchers explicitly
  receive filtered environments. Filtering follows shell.env overrides and is
  case-insensitive. Removed keys: DAX_SERVER_PASSWORD/USERNAME,
  DAX_SUBSTRATE_TOKEN, DAX_NATS_CREDS/PATH, DAX_API, DAX_CONFIG_CONTENT,
  and INFISICAL_* bootstrap variables. Project/provider variables remain usable.
  Parent credentials remain intact.
- Real subprocess controls reproduced credential inheritance in model shell,
  operator shell and plain snippets. The wrapped baseline instead lacked the
  dynamically assigned project variable; no wrapped credential leak was established.
  All four corrected producers preserve project environment without these keys.
- A raw network request without usable Host/absolute URL returns 400 instead of
  500. Forged internal requests still receive no private-TUI exemption.

The separate-agent reviewer accepted the exact final source after a pinned-Bun
probe covering 27 casing variants, preserved provider/project variables and a
frozen parent. This is bounded separate-agent review, not a whole-stack audit or
separate-model-family validation. Arbitrary trusted plugin code, shell profiles
and other same-user processes can still access credentials through other means.
Direct environment filtering is not OS isolation or verified human identity.

## Validation

- Focused production/network controls: **9 passed, 0 failed, 40 assertions**.
- Fresh independent clone, frozen Bun 1.4.0 install, clone-only v2.0.0 tag and
  **DAX_RELEASE=1 release:gates**: **2,399 passed, 2 skipped, 0 failed**;
  all five cold workspace typechecks, lint, 5/5 smoke evaluations, Rust
  fmt/clippy/tests, integrity and release checks passed. The clone tracked tree
  is clean. No tag was created in the primary repository.
- [Exact-source CI 37649534987](https://github.com/ShaileshRawat1403/dax/actions/runs/37649534987):
  Ubuntu, macOS and Windows all passed on attempt 1, including actual Windows
  operator commands with spaced script paths and quoted absolute executables.
  [CI receipt](evidence/release-2.0.0/operator-env/ci-receipt.json) retains the
  earlier unsuccessful source runs.
- Eleven archives were rebuilt with publication disabled. Archive hashes match
  the manifest, and main binary members match their corresponding build outputs.
  Prepared bytes are retained in `artifacts/release-2.0.0-2a75a43/` in the owned
  dax-patched-deps-validation worktree; do not discard them during cleanup.
- A real installer using an owned download fixture installed seven host files in
  a disposable destination; DAX reports 2.0.0 and its Rust core emits a proof.
  Corrupted checksum refusal preserves the previous dummy binary. This does not
  claim an install from published GitHub assets or execution of non-host binaries.

[Retained raw logs, receipts and checksums](evidence/release-2.0.0/operator-env/README.md)
include baseline reds, unsuccessful fixture type/lint attempts (including a repeated
unchanged lint failure), the first Windows fixture failure and final validation.
The Windows failure at 45d0484 was a missing probe file. Changing the fixture's
launcher at 02cc3ab did not fix it: returned output proved that quoted filenames
were passed literally. The production CMD correction uses /d /s /c, an outer
quote pair and windowsVerbatimArguments, matching [pinned Bun's protocol](https://raw.githubusercontent.com/oven-sh/bun/34cbb9a40/src/js/node/child_process.ts).
Authorization still binds and rechecks the submitted command; other shell
protocols remain unchanged. Tests now cover spaced script paths and a quoted
absolute executable, with every credential assertion retained. Exact-source
Windows CI passes; neither case is skipped.

## Release boundary

The original sprint ledger is empty within its documented scope. Unsupported
reviewed plugin/local-MCP/worker/verifier bindings remain blocked/backlog. Host-only
Rust sidecars remain a packaging limitation; no cross-target sidecar coverage is
claimed. Historical coverage, credential migration, journal downgrade restrictions
and review limits remain in [the release notes](../product/release-2.0.0.md).
Main still has eight until validated integration. Nothing is claimed error-free.

The operator binary remains SHA-256
`5671509d2f18e6d8316fee9bd7df34be96dd409ed628e9b6f5541d1b4e159fb0`.
