# Reviewed project-settings authority: candidate validation

Sole-owner candidate, 2026-10-05; no independent review, main merge or release.
Design: [explicit authority cutover](../roadmap/PROJECT_SETTINGS_CUTOVER.md).
This proposes closure of `scope.project-journal`; the candidate ledger has two
remaining grant/enforcement gaps. Published main still has eight accepted gaps.
Exact-commit Ubuntu/macOS/Windows CI is required before integration.

## Result and boundary

Actual protected operator proposal/review/publication controls and production PM
readers pass. Settings adoption requires approval of the exact full snapshot and
unchanged legacy digest. Reviewed replacement names its exact predecessor. No
setting mints a tool grant or replaces existing contract/permission enforcement.

Unenrolled SQL projects retain their behavior. Memory/convention promotion does
not enroll their settings. Adoption preserves historical SQL data. Enrolled
legacy commands refuse mutations and explain the protected review protocol.
Risk, preferences and constraints project from the journal. SQL notes, old memory
and RAO records remain diagnostics, not approved facts. Telemetry cites the
effective project revision after enrollment. Older binaries reject the new
settings event vocabulary; they must not continue enrolled histories.

## Production controls and validation

- Approval-only adoption; wrong digest and rejected approval leave authority unchanged.
- Legacy-data changes invalidate pending adoption; unrelated newer values survive.
- Effective preference, risk and nonempty constraint projections; reviewed removal.
- Concurrent replacements have one winner; stale predecessors cannot publish.
- Exact successful retries add no events; failed publication preserves legacy authority.
- Restart retries publish once; source-run removal preserves settings replay.
- Malformed authority rejects PM readers and real audit rather than empty/default policy.
- Actual `/pm rules add` and `/audit profile` return review guidance without mutation.
- Duplicate keys and unknown grant fields fail schema validation.
- The conformance check uses real production review/projection/source retention,
  replacing an obsolete source-text approximation.

Focused journal/scope/settings controls: **25 passed, 0 failed, 177 assertions**.
Final complete Bun 1.4.0 gates: **2,365 passed, 2 skipped, 0 failed, 9,055 assertions**
across 288 files; workspace typechecks/lint, 5/5 smoke evaluations, Rust
fmt/clippy/tests, integrity and release checks passed. Lockfile and manifests are
unchanged. Gates ran from the repo root with isolated DAX/XDG homes,
`NODE_OPTIONS=--max-old-space-size=4096`, disabled configuration auto-install and
model-catalog fetch, and explicit pinned Bun PATH.

The first command fixture omitted a model identity in a deliberately providerless
profile and failed with `no providers found`; it now supplies an explicit identity
without calling a provider. The first scope fixture omitted its isolated config
directory and failed ENOENT; the fixture now creates it. An early full run was
stopped during typecheck after discovering the command fixture failure. These
attempts are retained; no assertion was weakened and no test was skipped.
A preceding runtime gate passed 2,364 tests before the added final controls.
Recovery uses publication-boundary fault injection/restart, not an OS process kill.
The protected operator channel trusts its existing transport boundary; an actor
label is not cryptographic proof of a human decision. Source retention leaves
project commitments/references, not a recoverable deleted run transcript.

## Retained evidence

Files below are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `project-settings-final-focused.log.gz` | `cc346071148f1adaa5dd6d54cc3bc5cc3593025a58baf1b4567c4447fbd997ac` |
| `project-settings-final-gates.log.gz` | `4c3ca3b2970fff88e4992ede3062927116f8ca4288c4e70abe6261e3a46701f0` |
| `project-settings-command-fixture-failure.log.gz` | `24350689da3b4df8712f4e1f0d1cca6b83a54e6e4dcabb669bbb6d22803a1771` |
| `project-settings-scope-fixture-failure.log.gz` | `35f89fbfa9c51ae29b51615ff17407e64d13e37b5fc0d2f4d7c4bc8e781775ef` |
| `project-settings-stopped-gates.log.gz` | `70781e6d0c9cb4ce8eac00f6af955a1fc934560c7c62e8be20cbd18d89d05fda` |

The preceding Rust fixture correction at
`32b4a2e0ce3d01c0214d3aa0e0ce75f41be712cf` passed all three platforms:
https://github.com/ShaileshRawat1403/dax/actions/runs/37308437846.
Controlled fixture reuse reproduced the ranking failure mechanism; the original
hosted failure's exact timestamp collision remains unproven.
