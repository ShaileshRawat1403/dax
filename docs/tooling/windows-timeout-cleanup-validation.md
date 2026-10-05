# Windows timeout lifecycle and native descendant checks

Base: `bdde33e3c26ecb4fff11edf442e2a0b4a7644194`.
Codex sole implementation and validation; no independent reviewer is claimed.

## Failure evidence

[CI 37252092838](https://github.com/ShaileshRawat1403/dax/actions/runs/37252092838)
passed Ubuntu and macOS but failed Windows at the base. Two tests exhausted Bun's
default five-second budget: SDLC process-tree timeout and recovery pagination.
Recovery setup was still writing filler run 77 of 120 at expiration. The log
then shows the timed-out async fixture continuing into subsequent tests. This
proves a setup budget failure; it does not establish every historic recovery
failure's cause or a Windows filesystem performance root cause.

The old Windows descendant assertion used an MSYS shell `$!`, which is not a
reliable native Windows process ID. Its absence under `process.kill(pid, 0)`
cannot prove the actual Windows descendant exited.

## Corrections

- Windows tree tests launch native Bun parents/children and publish their actual
  Windows PIDs. POSIX retains the SIGTERM-ignoring shell test. Both keep the
  descendant-disappearance assertion; Windows now checks the actual process.
  Failure cleanup targets only fixture-owned PIDs and deletes the fixture.
- The tree test's total budget includes its 500ms execution timeout, cleanup and
  the separate five-second disappearance deadline. No test is skipped.
- A genuine check-runner race was reproduced locally: child close could settle a
  failed result while timeout tree cleanup was still pending. A regression delays
  cleanup after killing the real child and asserts settlement waits for cleanup.
  It failed before the correction and passes afterward. Timeout now exclusively
  owns result settlement until the existing cleanup finishes.
- Recovery's 120 fully persisted run lifecycles remain unchanged. A thirty-second
  fixture budget includes setup, pagination and awaited instance disposal. The
  test is not reduced to fewer rows or mocked storage.

## Validation

Focused Bun 1.4.0 controls: **13 passed, 0 failed; 27 assertions**.
Baseline cleanup-race negative control: **4 passed, 1 failed**, specifically
`cleanupComplete` was false when the result returned.
Full Bun 1.4.0 `release:gates` passed: **2,350 passed, 2 skipped, 0 failed**;
workspace typechecks/lint, all smoke evaluations, Rust and release checks passed.
[Compressed evidence](evidence/windows-timeout-cleanup/) preserves the failed CI,
red baseline control and passing local controls/full gates.
Exact-commit Windows/macOS/Ubuntu CI remains required before acceptance.

No merge, release, installed binary change or accepted aggregate gap closure.
Logical registration work is preserved separately on
`feat/legacy-runtime-capability-descriptors` at `91c6d64` as unfinished work;
it is not part of this correction.
