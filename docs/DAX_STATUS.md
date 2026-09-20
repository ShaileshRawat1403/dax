# DAX current ownership and release work

Codex retains DAX ownership after Claude's withdrawal on 2026-09-19. For the next
sprint, the maintainer will select an implementation model in the next session;
Astra 6 high is reserved for review. No implementation starts in this planning session.
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

All nine remaining gaps are scheduled in the
[next-sprint conformance plan](roadmap/CONFORMANCE_SPRINT.md), linked from the
[product roadmap](product/ROADMAP.md). The next-session implementation/reviewer split is recorded there; implementation
has not started. Closure is measured through production behavior, not structural checks.

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
gap checks reported CLOSED before being unwrapped; nine other gaps remain recorded.
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

This is solo validation, not independent second-model review. The multi-agent
SOP's historical lane split is dormant; its evidence discipline and gate table
still apply. Release publication requires a coherent clean tag, package version,
changelog, artifacts, and passing release-mode checks.
