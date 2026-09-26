# Native capability registry slice — validation and limits

Recorded 2026-09-26. Owner: Sol. Review: Astra, Tier 2 required before merge.
Branch: `feat/native-capability-registry`, based on approved proposal
`0cb2b34b5531a090da97f1d29dc0d537ca0bb586`; published source main was
`0170d2f8137bbd0abab7d9f6d72837ca5cec59f0`. Exact pushed review SHA and
hosted CI are supplied in the handoff, not inferred from a moving branch.

## Scope

Strict, immutable descriptive native capability catalog and private bindings to
the genuine definition's captured ID/initializer and initialized executor.
SessionPrompt direct tools, queued native task, batch leaves, and the actual
debug agent handler resolve before hooks/dispatch and call the captured function
with its original initialized receiver. Captured initializers retain their
original definition receiver too.
Same-name plugins retain plugin provenance and have no native descriptor; their
existing execution remains available. MCP execution is unchanged and unenrolled.

Descriptors never grant permission. `scopeSupport` describes support, not
confinement; shell and other opaque executors do not promise filesystem/host
restrictions. `requiresVerification` is descriptive, not a receipt or an override
of contract verification. No grants, shared grant resolver, contract migration,
legacy successor-run requirement, or new no-contract policy is implemented.
Existing approval, sandbox, scope, protected-path, mutation-observation,
verification, and completion boundaries remain in force.

Debug authority is unchanged: it uses Permission.disabled and a context whose
ask rejects deny rules, but does not perform native canonical settlement or
turn ask rules into interactive approval. Identity enrollment does not repair
that existing authority limitation or justify universal-enforcement closure.
Plugin/MCP, operator/workflow and worker/context adapters require smaller
separate reviewed branches. Both vocabulary/property aggregate gaps and all
eight ledger entries remain open; ordinary native regressions now coexist with
meaningful missing-descriptor checks on a real registered plugin.

## Local results

- Durable Bun:
  `/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`;
  explicit `--version`: `1.4.0`. Frozen install passed; lockfile/manifests unchanged.
- Focused tests: **39 passed, 0 failed, 183 assertions** across native-dispatch,
  contract-capability, batch-contract-authority, governing-run-authority and
  authority-integrity. Genuine definition ID/initializer mutation is rejected;
  changed executors are rejected before body/hooks; post-lookup mutation during
  a hook, ask callback or debug context await cannot replace captured execution.
  Same-name plugin dispatch succeeds without native enrollment. Frozen descriptor
  mutation cannot weaken a contract-blocked write; no-contract write permission
  flow and governing-child scope denials remain covered. Raw custom Tool.Info
  controls retain initializer and direct/batch execute receivers; these preserve
  plugin compatibility, not plugin capability enrollment.
- Stable final-source `release:gates`: **exit 0**. Integrity, legacy guard,
  typecheck, lint, **1,883 passed / 2 skipped / 0 failed**, smoke evaluations,
  Rust format/clippy/tests and release check passed. This is source validation,
  not `DAX_RELEASE=1` tagged release approval.
- Final gate environment: pinned Bun directory first on PATH;
  `NODE_OPTIONS=--max-old-space-size=4096`, matching CI; `DAX_TEST_HOME` and
  XDG config/data/cache set to task-local `profile-complete` directories.
  No maintainer home, credentials, sessions, or installed binary were replaced.
- No operator-visible UI behavior changed in this slice; no new interactive UI
  acceptance is claimed. Published v1.5.0/assets/installed executable unchanged.

Durable raw logs are under the owned worktree's ignored
`artifacts/validation/native-capability-registry/` directory, outside discovery:
`focused-final.log` and `release-gates-final-stable.log`. The handoff provides
their absolute location. Earlier completed green runs are retained in
`release-gates-complete.log` and `release-gates-receiver.log`, but predate the
combined receiver/fixture correction and are not final-tree evidence.

## Earlier failures and fixture corrections

Retained, not called passing evidence:

- `ci-f62c22d-windows-failed.log`: the superseded f62c22d CI passed Ubuntu/macOS
  but failed two debug-handler tests at synthetic afterEach cleanup with Windows
  EBUSY. Instance disposal already ran; cleanup now uses bounded fs.rm retries
  (10 retries, 100 ms delay) and still throws on final failure. No test is skipped
  and no authority assertion is weakened.
- `focused-receivers-final.log`: the first raw custom executor fixture reached
  its receiver but failed the existing canonical-result requirement; it now
  validates and publishes its result through captureValidatedResult, as required
  by the unchanged production settlement boundary.
- `release-gates-receivers-stable.log`: explicitly cancelled with exit 143 before
  the Windows cleanup fixture correction; partial, superseded, not final evidence.
- `focused-initial.log`, `focused-corrected.log`, `focused.log`: fixture failures
  included absent Git observation baseline, checking a batch summary rather than
  the persisted error part, missing isolated conformance home, and existing
  generic-edit forbidden-path rejection for a plugin named write. The final
  collision control uses a plugin named read; the write denial was not bypassed.
- `release-gates.log`: stopped at lint on newly introduced explicit any types;
  corrected executor typing without adding suppressions or weakening checks.
- `release-gates-final.log`: invalidated by source edits while running; it loaded
  pre-hardening implementation with newer on-disk identity tests. Its two failures
  are not evidence of final-source behavior.
- `release-gates-hardened.log`: **1,877 passed / 2 skipped / 1 failed**. The existing
  queued-task fixture replaced TaskTool.init, now correctly rejected by definition
  integrity. The guard was not weakened. That test now runs genuine TaskTool
  ask/authorize, child creation/inheritance, delegation and result settlement.
  Only the child SessionPrompt boundary returns a controlled synthetic reply;
  explicit general-agent model configuration supplies valid metadata. This avoids
  re-dispatching the parent's copied queued-subtask fixture into the child. The
  original authorization/invocation/result/completed assertions remain, with an
  added child governingRunId check. It does not prove full child-provider dispatch.

Earlier intermittent relay/macOS failures and the post-greeting Running/Brooding
observation remain separately tracked; this slice establishes no root cause or
additional gap closure.
