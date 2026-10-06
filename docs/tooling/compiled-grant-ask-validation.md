# Compiled operator ask and remembered dispatch acceptance

Base: scoped verifier correction `4bfef794e243543d6d08fd5be044181f97ee3dff`.
Test-only production acceptance; solo validation, not independent review.

## Actual flow

A genuinely compiled reviewed root dispatches a model-selected MCP tool through
real SDK/client/HTTP transport. Its published source grant requires an operator
ask. The actual RunRoutes approval handler receives the decision, not a direct
helper or manually fabricated approval request.

- While the genuine ask is pending, the server effect counter stays zero.
- A named operator approves with remember=true; the SDK tool then runs once.
- A second actual invocation under the same grant/capability/contract/binding
  tuple runs again without a new ask. Two server calls are recorded; replay
  accepts the remembered evidence chain.
- A fresh run with the same server/tool requests a new approval. Denial leaves
  its native invocation denied, stores no remembered tuple and makes no third
  server call. Memory is not reused across runs.

The remembered tuple is a capability/grant scope, not a promise that arbitrary
argument changes are newly approved. External server implementation remains
unattested. Existing permission narrowing and approval rejection controls remain
separate regression coverage.

The first fixture attempted to deny with an explicit remember=false field. The
approved API rejects that combination before mutation; the fixture now omits
remember for denial. That red attempt establishes no runtime defect.
The existing OS-kill control additionally asserts the owned child is live before
sending the termination signal.

## Validation

Bun 1.4.0 compiled and ask regression controls: **10 passed, 0 failed,
86 assertions**. Full release gates: **2,377 passed, 2 skipped, 0 failed**, including
workspace checks, lint, smoke, Rust and release checks. Final full log retains
real dispatch counters and all compiled matrix results. No manifest/lock changes.
Exact-commit three-platform CI remains required before integration.

No merge, release, installed binary replacement or accepted gap closure.
Session metadata integrity and the final entry-point inventory remain under audit.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `compiled-ask-fixture-payload-red.log.gz` | `da422db4360ac2ec0a09235b5df0060936b21233264cb2f0c762bd23bb536c8e` |
| `compiled-ask-final-focused.log.gz` | `3e6a207396791caa1348c95219334cf755c6bf38ef06f414d2a30e7598a9f2a0` |
| `compiled-ask-gates.log.gz` | `4f3ae1c2decb6dbdd48b3c333c58ed9553aa44a75ccad69aa66e7d7a94e733d8` |
