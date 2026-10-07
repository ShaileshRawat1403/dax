# Checkout-local cold typechecks and CI diagnostics

Base: `3fa281ecdac18b121a5fb0cfa8009fd4cc9bf6ff`.
No production executor/authority changes; solo validation is not independent review.

## Observations and correction

[CI 37603950466](https://github.com/ShaileshRawat1403/dax/actions/runs/37603950466)
failed Windows typechecking with exit 1 and no retained DAX compiler diagnostic;
other platforms were cancelled by matrix fail-fast. Its OS/process/launcher cause
is unknown. An unchanged rerun is not used as diagnosis.

Cold local typechecking independently exposed an actual reproducibility defect:
script/util compiler defaults discovered unrelated broken ambient D3 types under
`/Users/ananyalayek/node_modules/@types`, outside the frozen checkout. The retained
resolution trace proves that path. Cached typecheck results had hidden it. This
local finding does not explain the Windows exit.

All workspaces now constrain ambient type roots to their own node_modules/@types,
matching DAX's existing boundary. Imported dependency types and all existing
strict checks remain. No ancestor directory is changed. The root typecheck script
runs every workspace with concurrency 1 and streamed full task logs. This bounds
compiler fan-out and avoids grouped-output buffering; it is not a measured claim
of an OOM cause. CI uses that same root command and disables matrix fail-fast so
one failure cannot prevent the other platforms' evidence from completing. All
failed exit codes still fail their jobs; no continue-on-error, retries or skips.

## Validation and actual CLI build

Pinned Bun 1.4.0 cold workspace typechecks (`--force --concurrency=1
--log-order=stream --output-logs=full`): **5/5 passed, zero cached**, 18.328 s.
Frozen install passed without lockfile/dependency changes. Final full root gates:
**2,383 passed, 2 skipped, 0 failed**, plus workspace lint, smoke, Rust and release
checks. Exact-SHA all-platform CI remains required before integration.

An actual macOS ARM64 preview was built from the preceding runtime candidate
`3fa281e` (the correction here changes only check configuration). Explicit preview
version `0.0.0-conformance-3fa281e`, single host target, skip-install and publication
disabled. The fresh checkout lacked a model snapshot, so the deliberate unavailable
catalog attempt failed; the normal public models.dev catalog build succeeded,
including five Rust sidecars. This does not establish an offline build guarantee.
Version/help passed in an isolated home. An owned PTY rendered the real home
wordmark/prompt and exited on Ctrl-C with restored terminal state and exit 0.
No real provider call, user credential/profile edit, binary installation or release.

## Evidence

Files under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `final-ci-typecheck-red.log.gz` | `91a4c0d09ca00c2c38306003a7a151f515cfdc520fd89b6140825cd7d17f0902` |
| `typecheck-cold-ambient-red.log.gz` | `8e3b418b34747a5a163d70321b9659b762b79914e6c080cdcb2fe1b0355bb688` |
| `typecheck-ambient-resolution-red.log.gz` | `adcd70fe32fd28eb5d0dfc8a23c5cb4a8460dd6554057a9c1fb4272fb7f6ee3c` |
| `typecheck-cold-final.log.gz` | `4ad3cc80b982ab04d1c4a8333034fafbfdc4bb78a50580a53c5cfa5f3e908827` |
| `type-boundary-frozen.log.gz` | `494dee8d39977710772037f83823864021e25915f8af21c18d91e5be1c1a764f` |
| `type-boundary-gates.log.gz` | `9f8eee0c2e8d82aa9644143c2dc9f1a6150919654872ab9848e79ea9dff1435e` |
| `host-preview-offline-red.log.gz` | `1d55921a0b9d5c2ea0fa9c5a8d76bf9f465fc966723b65fca25570d4c5d7312f` |
| `host-preview-build.log.gz` | `42ba47fcdb6a3d5ae10eba617246fe25a1132c810b47950d65eb9b155536eb6a` |
| `host-preview-version.log.gz` | `7ae17417944bf02eaac2323d4d42f6e50555043e9830e8fae7bf185615ad901c` |
| `host-preview-help.log.gz` | `c5358373803e7ca8700dbe1681502b7b550e749f061ac47d67530872f21a388d` |
| `host-preview-tui.log.gz` | `f9498ccc31977db3364abc2886b1074f3a205cf6a2d2b6296f9ff71ac5bfd06d` |
