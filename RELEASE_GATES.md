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
- [ ] Scope and forbidden-path rules are enforced against Git-derived paths. Pending: WO-8: fix and enable the Rust policy floor.
- [ ] Verification runs before human review and fails closed. Pending: WO-11b: verify the execution integrity control is live.
- [ ] Approval remains an explicit operator decision. Pending: WO-5, WO-7 and WO-2b: repair permission evaluation, defaults and route gates.
- [ ] Evidence previews are redacted; exact-result digests remain in receipts. Pending: Share-upload redaction remains open; WO-9 and WO-8 cover digest integrity.

- [ ] The live audit event log is tamper-evident and verifiable. Pending: WO-8 (genesis boundary, keyed chain, and `dax verify`).

### Isolation and compatibility

- [x] Worker launch requires a successful OS-isolation probe.
- [ ] macOS Seatbelt and Linux bubblewrap plans have focused tests. Pending: WO-6: migrate and test every sandbox wrapper. WO-1 verified only the non-strict Seatbelt profile.
- [x] Unsupported worker platforms fail closed with an actionable message.
- [x] Built-in DAX workflows remain usable when worker isolation is unavailable.
- [x] A real repository worker run produces an approve or deny receipt.

### Release quality

- [ ] `bun run check:repo`
- [ ] `bun run --cwd packages/dax lint`
- [ ] `bun run typecheck:dax`
- [ ] `bun run test --coverage` (1,119 pass across 133 files)
- [ ] `bun run eval:smoke` (5/5 scenarios)
- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace`
- [ ] `bun audit` has zero high-severity findings
- [ ] Canonical release build produces all 11 target archives, manifest, installer, and verified checksums
- [ ] GitHub CI is green on Ubuntu, macOS, and Windows for `main` (run 29174772587).

WO-10a installs these checks in CI and release workflows. Re-tick only after the corresponding
checks pass on the candidate commit; local checks do not establish cross-platform CI or release-build success.
The dependency audit currently reports 15 high-severity advisories and blocks release.

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
