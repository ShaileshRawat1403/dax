# DAX 1.5.0 validation

Production candidate: `ce8cd25985d4d5ab18e2137a5edfb3946652247b`.
Test-fixture-only follow-ups through `a959fa7096d710dfecbca4adcc11f2923d454b9c`;
production sources are unchanged from that candidate.
Validation performed on 2026-09-20 (Asia/Kolkata). This is solo validation;
it is not an independent security audit.

## Results

- Full `bun run release:gates`: exit 0 using isolated Bun 1.4.0
  (`34cbb9a40`) and `NODE_OPTIONS=--max-old-space-size=4096`.
  Repository checks, all five workspace typechecks, lint, 1,764 tests
  (2 skipped), all five smoke evaluations, Rust fmt/clippy/tests, and
  release checks passed. This run was not in tagged release mode.
- Hosted [three-platform CI](https://github.com/ShaileshRawat1403/dax/actions/runs/35481919290):
  Linux, macOS, and Windows all passed at `a959fa7`.
- Host macOS ARM64 build passed, including all five Rust sidecars.
  The tested binary reports 1.5.0; its digest is in the TUI and live receipts.
- Real installer with locally served fixture assets installed the final binary
  and all five governance sidecars. The earlier candidate (`3ffa6cb`) also
  rejected a bad manifest checksum without installing a binary. These fixtures
  did not test a published GitHub release download.
- Final binary completed a live read-only `openai/gpt-5.5` prompt with the
  expected marker and exit 0.
- Final TUI displayed the home screen and selected model, then exited 0
  through Ctrl+C. This covers startup/exit, not every interactive workflow.

- Dependency audit checked 745 packages: no high-severity vulnerabilities;
  19 findings were below the configured high threshold.

## Defects found during release validation

The imported provider branch carried older Antigravity invocation flags. Its
Gemini isolation and worker doctor were integrated while retaining the newer
model selection, accept-edits mode, egress policy, output validation, and
process-lifetime safeguards. Historical provider evidence remains dated.

The TUI initially stayed blank. Temporary tracing showed five bootstrap RPC
requests sent before the worker registered its listener; none arrived. An
explicit readiness handshake queues those requests. Worker errors now reject
callers, and missing readiness has a timeout. Two regression tests pass with
the fix and time out against the previous RPC implementation. Tracing was removed.

Windows CI exposed path normalization errors in worker diagnostics and simulated
macOS sandbox plans, a missing ripgrep prerequisite, and a transient busy-directory
fixture cleanup. The fixes preserve test coverage; POSIX-only filesystem checks
remain platform-specific. Cleanup uses bounded retries and still fails if locked.

The earlier local lint attempt exhausted Node's default 2 GiB heap. The same
complete lint command passed with 4 GiB; CI and release instructions now use that
budget. No lint rules or release gates were removed.

## Compatibility review

Reviewed the deprecation tracker against the candidate. The run gateway and
legacy tool conversion implementation and their tests are unchanged from main;
explicit legacy fallback retains its warnings and authority marker. No deprecated
interface is removed in this release.

## Boundaries

Nine conformance gaps remain. The claims pack's v1.4.0 section is frozen; the two
integrity fixes are described separately. Older partial authority records without
a persisted initialization intent still fail closed.

Docker-dependent verification is unavailable without a daemon. The existing
release build supplies Rust sidecars only for the build host target; other
archives do not gain cross-compiled sidecars in this release. Eleven target
archives are built by the tag workflow, not by the local host-only smoke.

## Evidence

[Checksums](evidence/release-1.5.0/sha256.json) cover the retained artifacts.
[Gate receipt](evidence/release-1.5.0/gates.json) and
[raw gate log](evidence/release-1.5.0/gates.log.gz) pin the tested commit.
[RPC negative control](evidence/release-1.5.0/rpc-negative-control.txt),
[TUI smoke receipt](evidence/release-1.5.0/tui-smoke.json), and
[branch inventory](evidence/release-1.5.0/branch-inventory.json) preserve their
individual provenance. The inventory predates later fixes; every listed tip
was an ancestor of the candidate before cleanup.

[Hosted CI receipt](evidence/release-1.5.0/hosted-ci.json),
[Final installer receipt](evidence/release-1.5.0/installer-final.json),
[live CLI receipt](evidence/release-1.5.0/live-smoke.json), and
[dependency audit](evidence/release-1.5.0/dependency-audit.txt) record those checks.
