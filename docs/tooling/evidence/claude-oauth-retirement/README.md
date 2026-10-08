# Native Claude OAuth retirement validation

Approved scope: remove DAX's native subscription-OAuth login, bearer refresh and
Claude Code identity rewriting; preserve API-key authentication, old API-key
provider IDs, credential files and the separate official Claude Code worker.
The unused duplicate adapter was not registered or imported. The active Anthropic
adapter was registered; its retirement is a compatibility change, not dead-code
removal alone. This is Unreleased, outside the public/installed 2.0.0 binary.

## Source and controls

Source **70a39e84cb69e7e73d9a217621eb79513820d0c4** removes native OAuth handling
and retains explicit retired-token diagnostics before model dispatch. The API-key
menu and SDK loader remain usable; the old `claude-code` ID is API-only. HTTP
provider/auth controls verify both the label and real available methods. A sole
retired OAuth method cannot invoke login authorization. Persisted fixture tokens
remain unchanged across failed preflight and a valid environment API-key override.
The child probe has an owned deadline, kill-and-await cleanup and a minimal OS
environment; operator credentials, configuration overrides and bootstrap secrets
are absent before server import. No model/provider inference requests were made.

Five initial regression controls failed on baseline and passed with the correction.
The final focused suite passes 22 tests. Full pinned Bun 1.4.0 `release:gates` at
**331d43ff3ee6a96bd6f00060e2273c434caf65cf** passes 2,407 tests with zero failures
and no macOS skips; typechecks, lint, smoke evaluations, Rust checks and release
checks pass. [CI at 331d43f](https://github.com/ShaileshRawat1403/dax/actions/runs/37783836297)
passed all three platforms. The later 70a39e8 changes isolate the test environment
and correct a comment, without changing production behavior; focused tests,
package typecheck and lint pass. [Final exact-source CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37785135203)
passed Ubuntu, macOS and Windows, including Rust tests. `ci-70a39e8.json` retains
the source and job results. Bounded review accepted final source 70a39e8 with
all reported findings resolved; this does not establish the older EBUSY cause.

## Retained failures and limitations

- The first local gate failed on test any-casts and obsolete lint suppressions;
  those were corrected, not waived.
- The first endpoint probe read the default workspace rather than its fixture;
  adding an outside directory correctly returned 403. Running the owned child
  from its own project fixed the fixture while preserving transport boundaries.
- [First-source CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37782454631)
  passed macOS/Ubuntu but Windows failed strict deletion of the unchanged
  grant-stage4b compiled-probe fixture with EBUSY. Its OS handle/cause remains
  unidentified; subsequent corrective-source success is not a claim that it is fixed.
- Bounded review found and corrected a sole-method login bypass, a stale HTTP
  label, child ownership and inherited operator environment. This is separate-agent
  review of these paths, not a full independent security audit.
- Retirement cannot alter the immutable 2.0.0 assets; deployment needs a new patch.
  AGY latency was not measured or changed by this cleanup.

SHA-256 values cover **decompressed** log bytes.

| Log | SHA-256 |
| --- | --- |
| `baseline-controls.gz` | `e638b199dc20fbc86a465a7b0bb2b47b484a9d83126e685bc578b93882060ab4` |
| `initial-lint-failure.gz` | `7edc11924ad36113834373ce1e1bfad4a5d5767d37e2d6ecf44459ac7facfa2e` |
| `first-windows-ci-failure.gz` | `ef0b2f039fcc48177c5de13fa7d7527edc545016075c132144fb9e3b73ee4a1f` |
| `initial-endpoint-fixture-failure.gz` | `35a4b7db169ad5b9abb8ce0f7e5f1776c0f69cf7a0c5f51ccddce54ee739aa64` |
| `directory-boundary-fixture-failure.gz` | `56280dae02bd1a40dd8ca1162ccfec574445976bc70abd37b1ab02f018f82749` |
| `full-gates-331d43f.gz` | `f097045eda0e378d82a7a47bf0392bc64891ba100ceb2b82be495fb18fc05fa4` |
| `focused-70a39e8.gz` | `e480b14ce3ea8dd26860d3644dea5366e006c18c6188f2464f8f23fa1f00358a` |
| `typecheck-70a39e8.gz` | `f78ce44ef5883bcf8bc4bb97452aad3c9092ac7b3e722b1b5a185e84eb54f151` |
| `lint-70a39e8.gz` | `19879f39f18bdad96066eb69a98eb502b3e72edcae5bfac1867611817a8254b6` |
