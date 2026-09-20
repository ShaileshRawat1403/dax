# DAX current ownership and release work

Codex owns all implementation lanes after Claude's withdrawal on 2026-09-19.
The [original handover](HANDOVER_CLAUDE_TO_CODEX.md) is preserved verbatim; this
record supersedes its status and open findings. Work remains on feature branches;
the maintainer has authorized Codex to integrate validated branches into `main`
and delete them after verifying ancestry.

## Preserved work

The protocol, claims pack, toolchain evidence, and provider branch histories are
merged into the published `chore/dax-handover` candidate. No branch history has
been discarded. The maintainer authorized integration and deletion of merged
branches after ancestry checks.

The [1.5.0 validation record](tooling/release-1.5.0-validation.md) contains the
current evidence and release boundaries. The complete local release gates pass
at `ce8cd25`; Linux, macOS, and Windows CI passed at `a959fa7`. Tagged
publication is the remaining release step. The earlier missing-file, lint-memory, TUI startup, and Windows setup
issues have been addressed.

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

## Active release scope

Implemented shared filesystem locking for contract replacement and authority
establishment, plus recovery from a persisted initialization intent. Both original
gap checks reported CLOSED before being unwrapped; nine other gaps remain recorded.
Seven initialization regressions now pass, including cross-process contention,
concurrent retries, exact recovery settings, and corrupt/missing intent rejection.
The broader authority/recovery selection passed 32 tests before the final added
cross-process case. The provider branch has been integrated while retaining the newer
Antigravity model, process-lifetime, egress, and terminal-result safeguards. Its
Gemini isolation and worker diagnostics make the candidate version 1.5.0.
Pinned-runtime gates, host build, installer checks, live CLI, and TUI startup/exit
checks passed. Hosted CI passed on all three platforms. The tag workflow repeats
the gates in release mode before publication. Preserve the claims pack's `v1.4.0`
statements; describe newer behavior in a separately versioned update.

This is solo validation, not independent second-model review. The multi-agent
SOP's historical lane split is dormant; its evidence discipline and gate table
still apply. Release publication requires a coherent clean tag, package version,
changelog, artifacts, and passing release-mode checks.
