# DAX current ownership and release work

Codex retains DAX ownership after Claude's withdrawal on 2026-09-19. The current
conformance sprint uses Sol for implementation and Astra 6 high for architecture
and adversarial review.
The [original handover](HANDOVER_CLAUDE_TO_CODEX.md) is preserved verbatim; this
record supersedes its status and open findings. Work remains on feature branches;
the maintainer has authorized Codex to integrate validated branches into `main`
and delete them after verifying ancestry.

## Released baseline and next sprint

[DAX v1.5.0](https://github.com/ShaileshRawat1403/dax/releases/tag/v1.5.0) shipped
from `88e74c97c25a8bf1e304554d8e2c4ff45533ff09`. All six prior local branches were
integrated into published `main` and deleted after ancestry checks; their five
remote branches were deleted too. The detached Codex worktree and its artifacts
were preserved. No branch history was discarded.

The [1.5.0 validation record](tooling/release-1.5.0-validation.md) contains local
and candidate CI evidence. The [tagged release workflow](https://github.com/ShaileshRawat1403/dax/actions/runs/35482265176)
and [integrated main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/35482223816)
both passed. All eleven published archive digests matched the manifest and
GitHub asset digests; the published macOS installer was exercised and the local
1.4.0 executable replaced with 1.5.0.

At this pause checkpoint, the [conformance sprint plan](roadmap/CONFORMANCE_SPRINT.md), linked from the
[product roadmap](product/ROADMAP.md), retains the original scope of nine aggregate
gaps. Sol implemented and Astra reviewed the delegation, durable assistant-message,
prompt, context-contribution, and compaction-replacement provenance slices. The
complete-event-history workstream is integrated in `main` at
`7ccfc8a4cdd93ff054cabe2c43197438b88e8995`. Accepted record-class coverage is
**11/11**; `inv1.record-classes` is closed, leaving **eight aggregate gaps** in the
[gap ledger](../packages/dax/src/conformance/known-gaps.ts). The
[post-merge main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/35872303816)
passed on Ubuntu, macOS, and Windows, including Rust tests. This integration did
not publish a release; v1.5.0 remains the released baseline. The reviewed home
visual pass is integrated into the checkpoint source, also unreleased. The eight
remaining aggregate gaps are explicitly deferred during the maintainer's absence.

Compaction replacement binds the active prefix and summary before provider
dispatch. Successful adoption records a replacement boundary linked to final
prompt/context and assistant commitments; failed, cancelled, truncated, and empty
summaries close without replacement. Journal-only replay reconstructs boundaries
and commitments, while actual continuation needs stored summary text to pass
commitment verification. Historical unmarked history remains unavailable, not
inferred complete. The 11/11 measure is record-class coverage within its documented
producer scope, not a claim of complete model history or overall defect freedom.
Provider-adapter input commitments do not prove provider receipt. Digests cannot
reconstruct transcripts, and coverage of historical runs remains unknown. Recovery
from an OS process kill has not been tested. Older binaries cannot read the new
event vocabulary: do not direct the published v1.5.0 binary at newer development-state
journals.

## Pause checkpoint and restart

The checkpoint merges the approved status documentation at
`c10f48f9887968535500f7128c1f37508cd972ab` and home UI at
`9e245b839f9cf0871a18cb4194533789298587e3`, retaining the UI branch's design
ancestor `a8043169adb35a7fcc9e73967bf31160581d2835`. The only runtime change
relative to `7ccfc8a4cdd93ff054cabe2c43197438b88e8995` is the reviewed home
UI diff. The [checkpoint validation record](tooling/dax-pause-checkpoint-validation.md)
documents the reported local gates, missing raw logs, and verified exact-SHA CI.
This source checkpoint is not a release-readiness claim.

For local validation on macOS ARM64, follow the checksum-verified
[Bun 1.4.0 provisioning procedure](tooling/bun-toolchain-verification.md#reproduce-the-isolated-setup)
in a fresh DAX checkout. Confirm the resulting
`artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun --version` prints `1.4.0`
before putting that binary first on `PATH` and running the frozen install and
gates. Do not rely on a previous `/private/tmp` binary; it is no longer present.
To restart after the maintainer returns: fetch `main`, confirm the checkpoint's
integration and clean parity, read this status and the eight open ledger entries,
then choose one bounded gap on its own branch and obtain Astra's review before
integration. Keep development journals with their matching development binary.

## Evidence corrections

- Claude withdrew the first background discovery probe: its path did not match
  `packages`, and the fixture was removed while the process was running. Its 0/0
  is void. The second canary probe was reported complete; Codex's own raw evidence
  is in [the discovery investigation](tooling/bun-test-discovery-investigation.md).
- The Bun 1.3.9 fail/error counters describe one version-guard import failure.
  Claude independently confirmed this against its retained log. The handover's
  supposed second defect is withdrawn.
- The observed failure mode is broad discovery over an artifact-populated tree;
  the exact historical descriptor operation causing EMFILE was not isolated.
- The system Bun remains 1.3.9; the isolated Bun 1.4.0 binary is verified. The
  system package cache was removed during maintainer cleanup, while dependencies
  and the isolated runtime survived. No `bun link` or global runtime change is
  needed. Docker-dependent verification remains unavailable without a daemon.

## Shipped v1.5.0 scope

Implemented shared filesystem locking for contract replacement and authority
establishment, plus recovery from a persisted initialization intent. Both original
gap checks reported CLOSED before being unwrapped; nine other gaps formed the
original conformance-sprint scope.
Seven initialization regressions now pass, including cross-process contention,
concurrent retries, exact recovery settings, and corrupt/missing intent rejection.
The broader authority/recovery selection passed 32 tests before the final added
cross-process case. The provider branch has been integrated while retaining the newer
Antigravity model, process-lifetime, egress, and terminal-result safeguards. Its
Gemini isolation and worker diagnostics shipped in version 1.5.0.
Pinned-runtime gates, host build, installer checks, live CLI, and TUI startup/exit
checks passed. Hosted CI passed on all three platforms. The tag workflow repeated
the gates in release mode before publication. Preserve the claims pack's `v1.4.0`
statements; describe newer behavior in a separately versioned update.

The v1.5.0 validation was solo, not independent second-model review. The multi-agent
SOP's historical lane split is dormant; its evidence discipline and gate table
still apply. Release publication requires a coherent clean tag, package version,
changelog, artifacts, and passing release-mode checks.
