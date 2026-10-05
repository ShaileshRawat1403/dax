# Live session activity and durable run status

Base: `a1f87ccb3b9f3a483d83867f5a8ae0da86ad6b13`.
Owner: Codex, solo validation under the maintainer's 2026-10-05 direction.

## Correction

The canonical authority strip retains journal-derived lifecycle, sequence,
cursor, approval and completion-proof semantics. It separately labels live
session activity supplied from the selected session's status events. An idle
session whose run is still running reads `Run: Running` and `Activity: Idle`;
this neither fabricates completion nor represents durable running as a busy
provider. Unknown/unavailable authority remains explicitly unavailable.

The workstation consumes actual session activity rather than manufacturing
busy from a nonterminal run status. A finished conversational turn with an open
canonical run is ready for input, not canonically completed or assigned a
completion phase. Canonical terminal states remain authoritative; cancellation
is distinct in the workstation vocabulary. The older compatibility mapper
maps cancellation to its existing failure category; the canonical strip retains
its specific Cancelled label.

## Validation

Focused presentation controls: **52 passed, 0 failed; 152 assertions**.
Package typecheck passed. Full Bun 1.4.0 `release:gates` passed:
**2,349 passed, 2 skipped, 0 failed; 8,916 assertions**, with workspace
typechecks/lint, five smoke evaluations, Rust checks and release checks green.
[Compressed raw logs](evidence/workstation-live-activity/) preserve the local evidence.
Exact-commit three-platform CI remains a publication gate. The controls cover idle/busy/retry/delayed
activity, unavailable authority, unmodified canonical state, open versus completed
runs and cancellation mapping. These are presentation-model tests, not a mounted
TUI or a fresh provider-driven screenshot. Interactive confirmation is not claimed.

## Hygiene

Only `codex/review-native-capability` was fully incorporated into published
`origin/main`; it was deleted locally. Two invalid reviewer worktree registrations
were pruned after checking Git's missing gitdir targets. Existing directory contents
were not removed. All unmerged branches, dirty work, caches and evidence remain.

No merge, release, installed-binary replacement or aggregate gap closure is
claimed by this bounded presentation correction.
