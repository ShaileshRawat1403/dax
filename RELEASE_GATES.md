# DAX Release Gates and Non-Goals

## Candidate

`v1.2.0` ships governed external coding workers without expanding DAX into another general-purpose coding agent.

## Non-Goals

- Competing with frontier coding agents on raw model quality.
- Silent mutation, publish, deploy, recovery, or approval from free text.
- Claiming that governance makes stochastic model output deterministic.
- Claiming enterprise readiness before real-repository recovery and operator receipts exist.
- Claiming Windows external-worker isolation before the platform has a
  supported isolation boundary.

## Required Gates

### Trust and authority

- [x] Illegal run transitions cannot mutate canonical state.
- [x] DAX computes worker diffs instead of trusting worker self-reports.
- [ ] Scope and forbidden-path rules are enforced against Git-derived paths. Pending: the classifier's
      relative-path bypass is fixed and DAX's own credential stores are on the sensitive list, but the Rust
      policy floor stays opt-in behind `DAX_RUST_POLICY`: it fails closed when the sidecars are absent, and
      installs predating the `install.sh` fix have none. Enable by default once sidecars ship everywhere.
- [x] Verification runs before human review and fails closed.
- [x] Approval remains an explicit operator decision.
- [x] Evidence previews are redacted; exact-result digests remain in receipts.

- [x] The live audit event log is tamper-evident and verifiable (`dax verify audit`). Entries written before
      chaining have no digests and are reported as unchained rather than back-filled.

### Isolation and compatibility

- [x] Worker launch requires a successful OS-isolation probe.
- [x] macOS Seatbelt and Linux bubblewrap plans have focused tests.
- [x] Unsupported worker platforms fail closed with an actionable message.
- [x] Built-in DAX workflows remain usable when worker isolation is unavailable.
- [x] A real repository worker run produces an approve or deny receipt.

### Release quality

- [x] `bun run check:repo`
- [x] `bun run --cwd packages/dax lint`
- [x] `bun run typecheck:dax`
- [x] `bun run test` (1,455 pass across 198 files)
- [x] `bun run eval:smoke` (5/5 scenarios)
- [x] `cargo fmt --all -- --check`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `cargo test --workspace` (79 pass)
- [ ] `bun audit` has zero high-severity findings
- [ ] Canonical release build produces all 11 target archives, manifest, installer, and verified checksums
- [ ] GitHub CI is green on Ubuntu, macOS, and Windows for `main` (run 29174772587).

WO-10a installs these checks in CI and release workflows. Re-tick only after the corresponding
checks pass on the candidate commit; local checks do not establish cross-platform CI or release-build success.
The dependency audit still reports 15 high-severity advisories (34 total) and blocks release. They are
upstream and pre-existing; fixing them means major-version migrations, not an in-range bump.

## Known Operational Limits

- Worker provider calls use full network access; hostname allowlisting is future hardening.
- Worker profiles permit host reads and confine writes; use a container or VM for stronger confidentiality.
- Windows external workers are unavailable.
- The residual dependency advisories require major upstream migrations and are documented in the changelog.

## References

- [v1.2.0 release notes](./docs/releases/v1.2.0.md)
- [BYOA strategy](./docs/dax/byoa-strategy.md)
- [Transparency and limitations](./docs/product/TRANSPARENCY_AND_LIMITATIONS.md)
- [Architecture guide](./docs/architecture/ARCHITECTURE.md)
