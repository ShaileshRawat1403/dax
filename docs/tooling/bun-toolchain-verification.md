# Bun toolchain verification — 2026-09-18

## Outcome

The repository pin is available and can be used locally without replacing system
Bun. The official macOS ARM64 binary reports `1.4.0+34cbb9a40`; its frozen install
succeeded without changing `bun.lock` or another tracked file. No pin change is
needed for availability.

The runtime change has an observable consequence: Bun 1.3.9 is rejected by the
`^1.4.0` guard in `packages/script/src/index.ts:16`; Bun 1.4.0 passes that guard.
An isolated rerun of `packages/script/test/index.test.ts` gives **4 pass / 0 fail**
on 1.4.0 and **0 pass / 1 fail / 1 error** on 1.3.9.

Both full `release:gates` commands nevertheless exited 1: they passed integrity,
legacy guard, typecheck and lint, then stopped during tests with file-descriptor
errors. Equal aggregate exit codes do not mean equal underlying outcomes. The
1.3.9 version rejection was already present in the original committed log and was
omitted from this report at `f8d3f1710fffc4fd81b3a7d9481096ea004d9cba`.
This revision corrects that omission without replacing the historical logs.
Neither runtime has passed the complete gate chain in this worktree.

## Provenance and scope

- Source commit: `f31255b07d646d8d0a44560833bd61ffee6f00d3`.
- Worktree: `/Users/Shailesh/MYAIAGENTS/dax-codex`.
- Branch during execution: `chore/codex-bun-toolchain`.
- Host: Darwin ARM64. Node `20.19.6`; Cargo `1.93.0`.
- Pinned runtime: `1.4.0+34cbb9a40`, installed under this worktree's ignored
  `artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`.
- Comparison runtime: `1.3.9+cf6cdbbba`, from the existing
  `/Users/ananyalayek/.bun/bin/bun`. That installation was not changed.
- Both runs used the same dependency tree installed by Bun 1.4.0 from the frozen
  lockfile. This compares runtime behavior; it does not compare two installers.
- Both gate runs had `DAX_RELEASE` unset. This was development gate verification,
  not validation of a clean tagged release. No release build or upload ran.
- Logs were captured before adding this report, on an otherwise clean worktree.

The [official release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0)
and its [API metadata](https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v1.4.0)
identified the selected archive and its SHA-256 digest. The downloaded archive
matched `c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381`.
The extracted executable hashes to
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`.

The lockfile SHA-256 before and after installation and comparisons was
`4a153f81f30fc9775e9fc237e406d55ac220f677a36692dca01914a995192c1d`.
The install reported 776 packages installed and exited zero.

## Gate comparison

| Check | Bun 1.4.0 | Bun 1.3.9 |
| --- | --- | --- |
| `check:repo` | Pass | Pass |
| `guard:legacy` | Pass | Pass |
| `typecheck` | 5 successful, 0 cached | 5 successful, 0 cached |
| `lint` (DAX and other workspaces) | Pass | Pass |
| `test` | Fail: `EMFILE` during loading | Fail: Bun version guard, then `EMFILE` / `ProcessFdQuotaExceeded` during loading |
| `eval:smoke` | Not reached | Not reached |
| `rust:verify` | Not reached | Not reached |
| `release:check` | Not reached | Not reached |
| `release:gates` exit code | 1 | 1 |

Each selected Bun directory was prepended to `PATH`, so nested script invocations
used that version. `TURBO_FORCE=true` forced typechecks to execute; both logs
confirm zero cache hits. Turbo reported using its shared worktree cache; this
comparison does not assert cache-directory isolation. DAX state directories were
separate per runtime through `DAX_TEST_HOME`. Both runs disabled models fetching,
config auto-install and Turbo telemetry, and used the dedicated Bun install cache.
The normal test script additionally sets its own test isolation flags.

## Bounded failure investigation — original runs

The following supplemental checks used the same source and dependencies:

- `bun test packages/dax/test/determinism/completion-proof.test.ts packages/dax/src/conformance/known-gaps.test.ts`:
  **14 pass, 0 fail, 61 assertions under each version**.
- `bun test packages/dax/script/models-snapshot.test.ts`: each version exited 1
  with an `EMFILE` loading error; the reported module path differed.
- A direct `import { z } from "zod"` in `packages/dax` succeeded under each
  version. The dependency is present; this does not explain the loader failure.
- The inherited soft descriptor limit was 1048575; macOS reported
  `kern.maxfilesperproc=10240` and `kern.maxfiles=30720`. Lowering the limit to 8192
  only in a child process did not fix the 1.4.0 full test run. A targeted test in
  that experiment reported `Cannot find module '../installation'`, although the
  tracked `packages/dax/src/installation/index.ts` exists. That message is not
  evidence that the source file is missing.

No root cause of the file-descriptor failures is established. They were observed
under both versions; they do not establish a Bun 1.4.0 regression. The version
guard rejection is a separate, verified incompatibility with 1.3.9. No production
code, test code, global limits, package pin, lockfile or CI configuration was
changed for this verification.

## Cross-validation follow-up — explicit high-limit runs

The review attributed the failure to an 8192 soft limit. That was the separate
lower-limit diagnostic, not the original gate environment. The original report
recorded an inherited 1048575 soft limit. A successful run in another worktree
is useful counterevidence to a universal failure claim, but does not identify
this worktree's failure cause without controlling the remaining differences.

The follow-up ran both complete `bun run test` stages again, on the code at
`f8d3f1710fffc4fd81b3a7d9481096ea004d9cba`, with the same installed dependency tree
and fresh, separate DAX state directories. Python recorded the inherited soft
limit as 1048575, explicitly set it to **1048576**, and captured a shell's
`ulimit -n` through each selected Bun binary before launching the test stage.

| Follow-up | Bun 1.4.0 | Bun 1.3.9 |
| --- | --- | --- |
| Requested child soft limit | 1048576 | 1048576 |
| Shell launched by Bun reported | 1048576 | unlimited |
| Full `bun run test` | Exit 1; `EMFILE` | Exit 1; version guard and `EMFILE` |
| Isolated `packages/script/test/index.test.ts` | 4 pass, 0 fail, 6 assertions | 0 pass, 1 fail, 1 error; requires `bun@^1.4.0` |

The probe is a separate Bun invocation, not instrumentation inside the test
runner. The requested parent limit and probe output are both retained rather
than assuming a runtime leaves its inherited limits unchanged. Kernel limits
remained `kern.maxfiles=30720` and `kern.maxfilesperproc=10240`. Raising the soft
limit did not resolve the failure here; the claim that the cause is established
as the earlier 8192 diagnostic limit is not supported by this experiment.

The two full-stage runs failed in 0.93s and 0.40s respectively, before reaching
the suite completion summary. They do not independently reproduce the reviewer's
1737-test run or identify its remaining failure. Its exact invocation, source
SHA, dependency-install layout and full output are needed for that comparison.

To repeat the high-limit experiment, use the same isolated setup below with a
fresh `DAX_TEST_HOME` and run these commands inside the selected-runtime subshell:

```sh
ulimit -S -n 1048576
bun -e 'console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,nofile:Bun.spawnSync(["/bin/sh","-c","ulimit -n"]).stdout.toString().trim()}))'
bun run test
```

Run `bun test packages/script/test/index.test.ts` separately to isolate the
version guard. Do not infer a passing complete suite from this four-test check.

## Reproduce the isolated setup

Run from **your own** clean DAX worktree on macOS ARM64. Use a fresh artifact
directory. The checksum below belongs to the exact release asset, not latest Bun.

```sh
dax_toolchain="$PWD/artifacts/bun-toolchain/1.4.0"
mkdir -p "$dax_toolchain"
curl --fail --location --silent --show-error \
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-darwin-aarch64.zip \
  -o "$dax_toolchain/bun-darwin-aarch64.zip"
printf '%s  %s\n' \
  c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381 \
  "$dax_toolchain/bun-darwin-aarch64.zip" | shasum -a 256 -c - &&
  unzip -q "$dax_toolchain/bun-darwin-aarch64.zip" -d "$dax_toolchain"
```

Then select that binary only inside a subshell:

```sh
(
  export PATH="$PWD/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64:$PATH"
  export BUN_INSTALL_CACHE_DIR="$PWD/artifacts/bun-toolchain/cache-1.4.0"
  export DAX_TEST_HOME="$PWD/artifacts/bun-toolchain/home-1.4.0"
  export DAX_DISABLE_MODELS_FETCH=1 DAX_DISABLE_CONFIG_AUTO_INSTALL=1
  export TURBO_FORCE=true TURBO_TELEMETRY_DISABLED=1
  unset DAX_RELEASE
  bun --revision
  bun install --frozen-lockfile && bun run release:gates
)
git diff --exit-code -- bun.lock
```

For the comparison, select the existing 1.3.9 binary directory instead, use a
fresh `DAX_TEST_HOME`, keep the same installed dependencies, and run
`bun run release:gates`. Record the actual revision first. A successful install
or a passing targeted test must not be reported as a passing release gate chain.

## Retained evidence

The [receipt](evidence/bun-2026-09-18/receipt.json) records the source SHA, runtime
provenance, environment and hashes of every retained log. Text log copies have
trailing whitespace removed. Every original artifact named by
`raw_artifact_sha256` is now published byte-for-byte inside the
[raw archive](evidence/bun-2026-09-18/raw-artifacts.tar.gz), including the new
high-limit runs. The receipt records the archive hash and each member's original
hash. No local-only artifact is needed to check those fields. It accompanies:

- [Frozen install](evidence/bun-2026-09-18/install-1.4.0.log).
- [Bun 1.4.0 gates](evidence/bun-2026-09-18/release-gates-1.4.0.log) and
  [Bun 1.3.9 gates](evidence/bun-2026-09-18/release-gates-1.3.9.log).
- [Comparison results](evidence/bun-2026-09-18/comparison.json), with elapsed times
  for traceability, not as a performance benchmark.
- Targeted test and child-limit experiment logs in the same evidence directory.
- [Explicit-limit results](evidence/bun-2026-09-18/revalidation/comparison.json) and
  [isolated guard results](evidence/bun-2026-09-18/revalidation/version-guard-results.json).

For example, verify the original 1.3.9 gate log independently from the committed
archive (compare the result with `raw_artifact_sha256` in the receipt):

```sh
tar -xOf docs/tooling/evidence/bun-2026-09-18/raw-artifacts.tar.gz \
  release-gates-1.3.9.log | shasum -a 256
```

The remaining acceptance limit is explicit: later gates were not executed because
the test stage failed. No claim is made about how their results differ by runtime.
