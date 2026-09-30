# DAX handover: Sol to Claude Opus 5.5

Recorded: 2026-09-30. Sender: Sol. Recipient: Claude Opus 5.5, through the
maintainer. Independent final reviewer: Astra. This is a documentation-only
handover, not review acceptance, implementation authorization, or release approval.

## Freeze and exact starting point

The maintainer requested **implementation frozen**. No runtime work should resume
until the maintainer assigns the recipient a lane and its own branch/worktree.
Preserve existing branches, worktrees, development configuration, sessions,
dependency caches, and validation artifacts. Do not merge, cherry-pick preparation,
prune worktrees, replace the installed binary, tag, or publish a release as part
of this handover. Messages between agents go through the maintainer under the
[multi-agent SOP](MULTI_AGENT_SOP.md).

- **Recipient's runtime baseline:** `3c47d1a3045fa311bba4755d3aff8c5735e1baa2`,
  published on `test/conformance-file-fixture-scheduling`.
- **This docs branch:** `docs/sol-to-opus-handover`, created directly from that
  exact baseline. Its committed head is supplied with the handover; it adds only
  this document and does not alter the runtime baseline.
- **Accepted local/remote main:** `d2ef0b0f510c70df29d3855f399e02902fbe4014`.
  Both were verified equal and the maintainer checkout was clean at preparation.
- **Published release:** v1.5.0, from
  `88e74c97c25a8bf1e304554d8e2c4ff45533ff09`. Newer source is unreleased.
  Release assets, installed binary, and frozen release evidence remain unchanged.

Read [AGENTS.md](../AGENTS.md), the SOP, [current status](DAX_STATUS.md),
[stack operating model](STACK_OPERATING_MODEL.md), and
[sprint plan](roadmap/CONFORMANCE_SPRINT.md) before resuming. Some older validation
documents describe their own checkpoint as pending; the exact baseline evidence
below supersedes those pending CI statements, not their exclusions or limitations.

## What the baseline contains — and what it does not

Accepted main already contains delegation, assistant-message, prompt,
context-contribution and compaction-replacement provenance within the declared
producer scope: **11/11 record classes**, `inv1.record-classes` closed. It also
contains the reviewed terminal-home visual pass, Explore reply visibility fix,
strict descriptive native registry, and File scan ownership/disposal correction
with accessible-home-sibling handling. The precise Windows handle was not
identified; the verified claim is owned scans settle before strict deletion.

The unmerged stack from main to the recipient baseline adds:

- Loader-backed plugin/MCP tool identity, then separate built-in operator,
  fixed-workflow, worker, command-shell, local-context, MCP-resource,
  template-context and opt-in custom-tool identity slices. Descriptors bind
  selected executors; they never grant authority or attest trusted code.
  Existing v1/no-contract behavior, approvals, scope, sandbox and verification
  remain in force. Legacy custom tools/operators are explicitly unenrolled.
- Canonical path guarding, including missing targets through existing ancestors,
  symlink boundaries and Windows volume handling. It does not make opaque
  executors confined or eliminate filesystem time-of-check/time-of-use risks.
- Shared journal locking, sequence/CAS validation, duplicate-command behavior,
  batch validation and atomic publication; run and project journals have
  independent owners and reducers using the same storage primitive.
- A project fact journal with approved promotion/supersession/retirement,
  digest-bound canonical run approval, atomic genesis plus first fact, and
  replay independent of continued source-run availability. This is a storage
  boundary, **not** an operator-facing producer or migration of PM's SQLite
  read/write authority.
- Explicit new-run v2 event-envelope cutover. New canonical initialization
  records its format before genesis; historical v1 logs and interrupted v1
  recipes retain v1. Owner/version selection and validation occur under the run
  lock. Mixed versions and conflicting recipes require recovery. v2 persists
  cross-scope citations; v1 refuses them rather than silently dropping them.
  A citation does not grant authority or prove its source exists; the project
  producer separately checks the cited approval before publication.
- A template-reference ordering fix, two narrowly patched dependency overrides,
  and deterministic File test synchronization. The final fixture commit does
  not change File runtime behavior.

**Not present:** production contract-v2 grant activation, universal shared grant
enforcement, an operator memory-promotion flow, or production project-memory
journal migration. Run **envelope v2** and execution **contract v2** are separate
compatibility decisions. Approval of the former did not approve the latter.

Accepted main still has **eight aggregate gaps open**. The baseline candidate
ledger has six entries, proposing closure only of `scope.journal-primitive` and
`scope.aware-envelope`. These two proposals need Astra's final review and
integration; they are not accepted main closures. The capability ledger prose
still names some families now partially enrolled by later slices. Treat that
description as stale inventory text, not proof of universal coverage or permission
to remove those entries. The complete eight-gap goal is **not finished**.

## Slice inventory: preserved branch, actual base, exact head

All SHA values below are full commit IDs. “Base” is the original branch creation
point, verified against local reflogs and ancestry, not necessarily the immediate
parent of the head. Every head in this table is an ancestor of the runtime baseline
and matches its fetched `origin` branch. Branches are retained, not merged to main.

| Slice / preserved branch | Base SHA | Head SHA |
| --- | --- | --- |
| Proposal — `docs/plugin-mcp-capability-proposal` | `d2ef0b0f510c70df29d3855f399e02902fbe4014` | `7ea7938e5208168f0e8a819f1e4fe907698cdd2f` |
| Plugin — `feat/plugin-capability-identity` | `7ea7938e5208168f0e8a819f1e4fe907698cdd2f` | `051c1752ae7842c6bb99ed1e121c13832ab6449f` |
| MCP tools — `feat/mcp-capability-identity` | `051c1752ae7842c6bb99ed1e121c13832ab6449f` | `b26058ffd3f3bb230f645621b5efe9906ae3ca03` |
| Operators — `feat/operator-capability-identity` | `b26058ffd3f3bb230f645621b5efe9906ae3ca03` | `ccd4dd37fc1c4370849d1bb056c43cc5c15b0617` |
| Workflows — `feat/workflow-capability-identity` | `ccd4dd37fc1c4370849d1bb056c43cc5c15b0617` | `afb7d7eb158cd900f4a805fb7313f5ea83a2c5b2` |
| Workers — `feat/worker-capability-identity` | `afb7d7eb158cd900f4a805fb7313f5ea83a2c5b2` | `a51433f613f4376b1d218c869702ba032f0e19c7` |
| Path guards — `fix/runtime-guard-canonical-paths` | `a51433f613f4376b1d218c869702ba032f0e19c7` | `11a3533702e4fdeac6d0cbca8d1c167d9341a294` |
| Command shell — `feat/command-shell-capability-identity` | `11a3533702e4fdeac6d0cbca8d1c167d9341a294` | `a768d0219afed53f2c23d2b7cab4250ee1f352ae` |
| Local attachments — `feat/prompt-context-capability-identity` | `a768d0219afed53f2c23d2b7cab4250ee1f352ae` | `178ec84e1246e7d9ee24e79790224ba70a7b1086` |
| MCP resources — `feat/mcp-resource-capability-identity` | `178ec84e1246e7d9ee24e79790224ba70a7b1086` | `2e95c8d16f6c2106ac3fce28a0b7be25cc1511a9` |
| Template references — `feat/template-context-capability-identity` | `2e95c8d16f6c2106ac3fce28a0b7be25cc1511a9` | `1348e7d28b35fc9153e91604eca20eaacb2403c4` |
| Opt-in custom tools — `feat/owned-custom-capability-identity` | `1348e7d28b35fc9153e91604eca20eaacb2403c4` | `b2e99549819a42c6abe71d5f4ebb0ef720a79daa` |
| Shared journal — `feat/scoped-journal-primitive` | `b2e99549819a42c6abe71d5f4ebb0ef720a79daa` | `e2ac9cb1746e64b19515b330d77c0dfde957af5f` |
| Envelope readers — `feat/scope-aware-envelope` | `e2ac9cb1746e64b19515b330d77c0dfde957af5f` | `5a5ebe10dafb8c7c7293e3648f280f3a6e6acb04` |
| Project journal — `feat/project-scoped-journal` | `5a5ebe10dafb8c7c7293e3648f280f3a6e6acb04` | `cffb98b1b8018767c33214b8eaa37c70aee8729a` |
| New-run envelope cutover — `feat/run-v2-envelope-cutover` | `cffb98b1b8018767c33214b8eaa37c70aee8729a` | `05bf3b2e47660c1506b1aa34ae6059d3566a3c64` |
| Dependency audit — `fix/conformance-audit-dependencies` | `05bf3b2e47660c1506b1aa34ae6059d3566a3c64` | `6eb9e2d1a76f4ce34a7aa7252c3012f479aa9567` |
| Final test fixture — `test/conformance-file-fixture-scheduling` | `6eb9e2d1a76f4ce34a7aa7252c3012f479aa9567` | `3c47d1a3045fa311bba4755d3aff8c5735e1baa2` |

The cutover branch also contains the separate ordering corrective commit
`68f9e5df2c3083fc118907525983076d70d93a3d`, whose parent is the project-journal
head. It preserves template source order instead of asynchronous stat completion
order. The path-guard branch is **included**, not excluded preparation.

`test/run-envelope-audit-validation` is a local validation-only branch created
from `6eb9e2d1a76f4ce34a7aa7252c3012f479aa9567` and fast-forwarded to the final
baseline; it contains no additional implementation commit and has no origin branch.
`codex/review-native-capability` is Astra's historical local alias of accepted main,
not a new implementation slice.

## Excluded preparatory fork — especially a2cab737

These branches diverge from the included custom-tool checkpoint. Their heads are
**not ancestors of** `3c47d1a3045fa311bba4755d3aff8c5735e1baa2`; the journal
stack did not build on them. Both match their remote heads and are preserved.

| Preparatory branch | Base SHA | Head SHA |
| --- | --- | --- |
| `feat/capability-contract-grants` | `b2e99549819a42c6abe71d5f4ebb0ef720a79daa` | `20ebf4902ebc2c9b3dce7791f9903730af669f18` |
| `feat/native-grant-enforcement` | `20ebf4902ebc2c9b3dce7791f9903730af669f18` | `a2cab7370582f96f8a70978994f92ad11de3423a` |

The contract fork defines a strict `ExecutionContractV2` grant schema and pure
resolver at `af3b216546014341ddfac8df00d62a8ce364126b`. Followups
`19f09375fa4d2736d533bcfaae12306b5b5ad42d` and its final head keep v2 inert:
production guardian read/write refuses unsupported contract versions rather than
admitting authority before universal enforcement. Earlier automatic approval
review blocked broad activation; envelope-cutover approval does not remove that
boundary. Existing v1/no-contract behavior is preserved.

**`a2cab737` is preparatory native invocation plumbing, not a completed grants
system.** It intersects historical allow/block filtering with a selected-executor
grant decision and wires descriptors into native invocation boundaries, including
ordinary/queued dispatch and batch leaves. Only native read/write/edit's validated
single `filePath` population is supplied as filesystem target evidence; other
unproven scopes deny. It adds an optional capability ID to native event receipts.
Production still cannot admit v2 contracts. An `ask` result currently fails closed
as `capability_grant_approval_required`; it does not provide the missing operator
approval flow. Other executor families do not receive universal shared enforcement.

Inspect it separately with `git diff 20ebf4902ebc2c9b3dce7791f9903730af669f18..a2cab7370582f96f8a70978994f92ad11de3423a`
and the contract fork with `git diff b2e99549819a42c6abe71d5f4ebb0ef720a79daa..20ebf4902ebc2c9b3dce7791f9903730af669f18`.
Do not automatically merge either into the recipient baseline. Any future reuse
needs reconciliation with the later journal/envelope tree, the authority-policy
decisions below, and behavioral validation. A green preparatory branch is not a
grant-migration approval or evidence of gap closure.

## Tests and evidence by slice

The following are actual source test files, not filename-based closure proofs.
They are included in the final-source full gate suite unless explicitly marked
excluded. Identity checks preserve existing denial behavior, use actual production
callers, and control external provider/process boundaries where noted. They do
not establish protection from arbitrary trusted code calling its own effects.

| Slice | Behavioral entry points / evidence |
| --- | --- |
| Proposal | [Approved boundaries](roadmap/PLUGIN_MCP_CAPABILITY_PROPOSAL.md); no execution authority from descriptors. |
| Plugin | [Loader/dispatch tests](../packages/dax/src/capability/plugin-dispatch.test.ts), [dynamic identity](../packages/dax/src/capability/dynamic-identity.test.ts), [validation record](tooling/plugin-capability-identity-validation.md): real directory/configured loaders, native-name separation, collision publication, mutation before/after hooks and approvals, overlapping discovery, unrelated sources; four controls fail against exported main. |
| MCP tools | [Dispatch tests](../packages/dax/src/mcp/capability-dispatch.test.ts), [validation record](tooling/mcp-capability-identity-validation.md): real loopback HTTP and stdio SDK transports, ordered discovery including SDK validators, notifications/disconnect, post-approval checks, no retarget/retry; four controls fail against the plugin-only baseline. |
| Operators | [Graph tests](../packages/dax/src/operators/capability-identity.test.ts), [implementation note](roadmap/OPERATOR_CAPABILITY_SLICE.md): real Git-status graph, construction/executor/action identity, forged/duplicate registration and unchanged legacy custom behavior. |
| Workflows | [Production method tests](../packages/dax/src/workflows/capability-identity.test.ts): four fixed classes, execute/resume phases, run/contract-class mismatch before effects, existing approval behavior. |
| Workers | [Profile/invocation tests](../packages/dax/src/worker/capability-identity.test.ts): built-in provider/profile and invocation mutation; checks before checkout and launch, no claim of worker cooperation as confinement proof. |
| Path guards | [Canonical path tests](../packages/dax/src/execution/runtime-guard-path.test.ts): absolute/relative targets, missing descendants, symlink escape, worktree/global-root behavior and platform paths. |
| Command shell | [Real command tests](../packages/dax/src/session/command-shell-identity.test.ts): selected snippets, normal approval/denial, mutation before shell effects; shell scope remains opaque. |
| Local attachments | [Real prompt tests](../packages/dax/src/session/context-attachment-identity.test.ts): stat/read/list/media binding, changed inputs/executors, existing sensitive-path denial before ReadTool effects. |
| MCP resources | [Transport/resource tests](../packages/dax/src/mcp/resource-identity.test.ts): source-qualified lookup, duplicate catalog identity, disconnect during reads and unrelated-source isolation. |
| Template references and ordering correction | [Producer tests](../packages/dax/src/session/template-context-identity.test.ts): real reference resolution, forged/changed binding, failure before provider dispatch; controlled delayed stat proves the old producer's source-order defect. |
| Opt-in custom tools | [Native/registration dispatch tests](../packages/dax/src/capability/native-dispatch.test.ts), [record](tooling/custom-capability-identity-validation.md): direct/batch paths, receiver/executor binding, malformed source/schema, collisions, post-hook rejection and legacy registration compatibility. Source is caller-declared, not independently attested; this is a later interface candidate, not part of the initial plugin architecture approval. |
| Shared journal | [Journal tests](../packages/dax/src/state/events/journal.test.ts), [foundation record](roadmap/SCOPED_JOURNAL_PRIMITIVE_VALIDATION.md): sequence/CAS, duplicate command, lock serialization, atomic publication and malformed-log rejection. |
| Envelope readers | [Scope tests](../packages/dax/src/conformance/scope-authority.test.ts), [run integrity](../packages/dax/src/state/events/run-log-integrity.test.ts), [compatibility record](roadmap/SCOPE_ENVELOPE_COMPATIBILITY.md): historical v1, v2 ownership/references, wrong-owner and mixed-format rejection. Reader-only at this slice, writer enabled later. |
| Project journal | [Project journal tests](../packages/dax/src/state/events/project-journal.test.ts), [candidate record](roadmap/PROJECT_JOURNAL_CANDIDATE.md): denied first fact creates no journal; approved digest binding, edited payload, missing source, duplicates, conflicting transitions, publication failure and replay after source-run removal. A killed child publisher is tested, not a full-DAX OS-kill recovery flow. |
| Run cutover | [Cutover tests](../packages/dax/src/state/events/run-envelope-cutover.test.ts), [record](tooling/run-envelope-cutover-validation.md): actual initialization/appends, interrupted v1 recipe, v2 genesis, concurrent initialization, owner injection, malformed references and conflict rejection without journal changes. |
| Dependency patch | Only `brace-expansion` 5.0.11 and `undici` 6.28.1 overrides and corresponding lock entries changed. Frozen install, high-severity audit and full gates; no audit waiver or blanket upgrade. |
| Final File fixture | [Lifecycle tests](../packages/dax/src/file/index-lifecycle.test.ts): explicit retry-start/release barriers and real directory snapshots; 100 pending searches stay nonblocking/empty before recovery. Error/cache/cancellation/strict-cleanup assertions preserved, no longer blind retries or skips. |
| Excluded contract/native grant preparation | Inspect `capability/grant.test.ts`, `conformance/contract-capability.test.ts` and native event tests **on those branches**, not as included baseline tests. Pure resolution and unsupported-v2 refusal are not universal production activation. |

### Final baseline validation, pinned to 3c47d1a

These are Sol's local results plus hosted CI, **not independent Astra/Opus
cross-validation**. No runtime gates are rerun for this docs-only handover.

- Bun **1.4.0** (`34cbb9a40`) at
  `/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`;
  version rechecked during handover. Follow the
  [checksum-verified provisioning procedure](tooling/bun-toolchain-verification.md#reproduce-the-isolated-setup)
  elsewhere; never assume a former temporary binary survives.
- Final full `release:gates`: **2,063 passed, 2 skipped, 0 failed; 6,921
  assertions**, five workspace typechecks, lint, smoke evaluations, Rust
  formatting/clippy/tests, and source release checks passed. This is not tagged
  release-mode installation validation or a live-provider smoke claim.
- Focused cutover/shared-journal/project/replay/template selection: **59 passed,
  0 failed; 189 assertions**. File lifecycle: **18 passed, 0 failed; 281 assertions**.
- Frozen install passed in the clean validation worktree; corrected `bun.lock`
  remained unchanged, SHA-256
  `831bad444f35a22dd8469507f15aac499809502eed5b09781d0c86ba35e642de`.
- [Exact baseline CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36695217941)
  passed Ubuntu, macOS and Windows, including Rust tests; exact head and all
  three job conclusions rechecked during handover. Platform-required steps
  passed; CI's existing Windows frozen-root step is skipped by workflow policy.
- High-severity audit passed; **20 below-threshold findings remain**. This is
  not zero vulnerabilities or an error-free/release-ready claim.
- Earlier baseline checks resolved 22 relative documentation links and passed
  `git diff --check`; this new document's links, SHA inventory and docs-only diff
  are checked separately before commit. Frozen v1.5.0 evidence has no candidate diff.

Durable evidence root, verified present and left untouched:

`/Users/Shailesh/MYAIAGENTS/dax/artifacts/validation/run-v2-envelope-cutover-20260930/`

| Evidence file under that root | Meaning |
| --- | --- |
| `REVIEW_HANDOFF.md`, `final-ci-receipt.json` | Existing final runtime handoff and exact-head hosted job receipt. |
| `final-release-gates.log` | Final combined-source gates; SHA-256 `66e4f8e98c9415b0cb8f2573b4dc998031840bd080de462264221d727a313c7b`, rechecked during handover. |
| `focused.log`, `file-fixture-focused.log` | Focused selections above. |
| `clean-worktree-install.log`, `dependency-audit.log` | Frozen dependency installation and thresholded audit evidence. |
| `release-gates.log`, `clean-worktree-release-gates.log` | Earlier passing cutover/dependency runs; do not substitute for the final-source log. |
| `preceding-project-ci-failure.log`, `first-ci-failure.log`, `dependency-ci-failure.log` | Retained unsuccessful CI attempts below. |
| `contaminated-worktree-gates.log`, `type-resolution-failure.log` | Failed environmental gate attempt and resolution trace; not hidden by the later pass. |

Existing plugin/MCP/custom/operator evidence directories also remain under the
main checkout's `artifacts/validation/`. Their per-slice documents above describe
historical controls and terminal captures; check each artifact's existence before
citing it as inspectable. Ignored local evidence is not carried by `git clone`.
This handover does not commit user journals, credentials, screenshots or raw logs.

**Excluded a2cab737 evidence:** Sol previously reported full gates **2,045 passed,
2 skipped, 0 failed**. Its [exact-SHA hosted CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36593891499)
reports success and its head was rechecked. The former passing log
`/private/tmp/dax-native-grants-gates.BPk8PX/gates.log` and initial lint-failure log
`/private/tmp/dax-native-grants-gates.K4Yepb/gates.log` are **absent at handover**.
Those local results are Sol-reported, unavailable for independent raw inspection;
they are not evidence that the excluded code is included or accepted.

### Unsuccessful attempts and separate observations

- [Project checkpoint CI 36594783791](https://github.com/ShaileshRawat1403/dax/actions/runs/36594783791)
  failed the macOS template-order assertion; Ubuntu passed, Windows cancelled.
  Controlled delayed-stat regression reproduced the ordering defect; `68f9e5d`
  corrects production ordering. An initial probe had wrong punctuation and timed
  out before the corrected fixture exposed the intended failure.
- [Cutover CI 36693166730](https://github.com/ShaileshRawat1403/dax/actions/runs/36693166730)
  failed high-severity audit on all platforms before code tests; the two dependency
  overrides above address those advisories, not unrelated dependencies.
- The first dependency local gate stopped on broken implicit `d3-*` types in
  user-owned `/Users/ananyalayek/node_modules/@types`, outside DAX. Resolution
  evidence was retained; no user directory was deleted and typechecks were not
  bypassed. Validation moved to a clean worktree under the Shailesh repo root.
- [Dependency CI 36694379830](https://github.com/ShaileshRawat1403/dax/actions/runs/36694379830)
  failed the macOS File recovery fixture's OS-read/event-loop timing assumption;
  sibling jobs were cancelled. Final test-only synchronization replaces that
  assumption without changing File runtime, swallowing errors or weakening tests.
- Historical intermittent relay failures, a macOS approval-wait failure, and the
  post-greeting Running/Brooding label remain separate unresolved observations.
  Do not assert a root cause, treat them as grant failures, or silently fold a
  status/UI refactor into this handover. The baseline was not green on its first
  attempt; retained failures remain part of the evidence.

## Unresolved decisions and remaining work after the freeze

These are planning boundaries, **not instructions to implement now**. The six
candidate entries in [the ledger](../packages/dax/src/conformance/known-gaps.ts)
remain open; accepted main also retains the two proposed journal closures.

| Candidate gap | What is still required |
| --- | --- |
| `inv5.capability-vocabulary` | Complete a consequential entry-point inventory against actual execution, not names. Decide explicit policy for unenrolled legacy custom tools/operators, plugin initialization/hooks, arbitrary trusted SDK effects and other adapters. Partial descriptive enrollment is not universal mediation. |
| `inv5.capability-properties` | Confirm strict intrinsic properties for that declared population, validated targets where enforceable, conservative opaque scope elsewhere, and historical unknown coverage. Reconcile stale inventory text only with behavioral evidence. |
| `inv5.contract-grants` | Decide contract-v2 activation and migration, v1/no-contract policy, successor-run operator flow, immutable grant ownership/validation and an actual operator `ask` flow. Existing approvals/sandbox/scope must not be bypassed. Preparation is excluded above. |
| `inv5.grant-resolution` | Shared resolution at every in-scope effect boundary, before hooks and again after awaited approvals; batch/delegation/alternate entry points, stale catalog identity, scoped targets and durable negative receipts must be tested. No automatic retarget or effect retry after identity/provenance failure. |
| `scope.project-journal` | Migrate real PM production reads/writes and add the operator review consumer/producer; define historical SQLite compatibility, authority/cutover and read consistency. A new storage API alone does not close this gap. |
| `memory.no-producer` | Define what may be promoted, by whom, with exact reviewed content, privacy/retention, deduplication, supersession/retirement and revocation behavior; implement operator-authorized durable promotion and future-session consumption. Models may propose, never authorize persistent memory. |

For the two proposed journal closures, independently review cross-process/CAS
concurrency, interrupted publication, source-reference validation, owner isolation,
historical recipes and mixed-version rejection. Run journal scope references are
citations, not copied state or proof of continued source existence. Project facts
are persisted content, so promotion/privacy policy cannot be replaced by hashing.

Keep retained commitments versioned and content-free where that is the declared
boundary. Provider-adapter commitments do not prove HTTP payload or provider
receipt. Digests are neither encryption nor reconstructable transcripts.
Historical coverage remains unknown. Ordinary provider retries and provenance
persistence failures have different semantics: uncertain durable writes require
recovery, not another automatic model/effect call or successful completion.

Full-DAX interrupted-process OS-kill recovery, compatibility/install/upgrade,
release-mode gates, user-flow acceptance for future UI changes and remaining
release blockers still need evidence before any new release. A killed project
publisher test is not a substitute. Docker-dependent checks require an available
daemon. v1.5.0 must not open newer development event vocabularies/v2 journals.
Neither an empty gap ledger nor this handover would authorize release.

## Worktree ownership at handover

All existing paths below were inspected read-only with `git status --porcelain`;
present worktrees had clean tracked/untracked status before adding this document.
Ignored development state/artifacts are not evidence of disposable directories.
Branch names in this table map to the exact heads in the inventory above.
Directories named `.claude` do **not** imply current Claude ownership.

| Owner | Worktree path | Checked-out branch / status |
| --- | --- | --- |
| Maintainer | `/Users/Shailesh/MYAIAGENTS/dax` | `main`; clean, accepted baseline only. Preserve `.env.local`, sessions and all artifacts. |
| Astra, historical | `/private/tmp/dax-astra-native-review` | `codex/review-native-capability` at accepted main; path absent, stale registration retained. Do not prune or take over its branch. |
| Sol | `/Users/Shailesh/MYAIAGENTS/dax/.claude/worktrees/native-capability-registry` | `feat/mcp-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/operator-capability-identity/dax` | `feat/operator-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/workflow-capability-identity/dax` | `feat/workflow-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/worker-capability-identity/dax` | `feat/worker-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/runtime-guard-paths/dax` | `fix/runtime-guard-canonical-paths`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/command-shell-identity/dax` | `feat/command-shell-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/context-read-identity/dax` | `feat/prompt-context-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/mcp-resource-identity/dax` | `feat/mcp-resource-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/template-context-identity/dax` | `feat/template-context-capability-identity`; clean. |
| Sol | `/Users/ananyalayek/.codex/worktrees/owned-custom-capability/dax` | `test/conformance-file-fixture-scheduling`; clean at runtime baseline. Directory name is historical, not its current branch. |
| Sol, validation only | `/Users/Shailesh/MYAIAGENTS/dax/.claude/worktrees/run-envelope-audit-validation` | `test/run-envelope-audit-validation`; clean at runtime baseline, frozen dependencies used for final gates. |
| Sol, docs only | `/Users/Shailesh/MYAIAGENTS/dax/.claude/worktrees/sol-to-opus-handover` | `docs/sol-to-opus-handover`; only this handover is added. |
| Opus | Not yet assigned | No worktree/branch ownership or independent Opus validation is claimed. |

The remaining preserved slice branches have no separate checked-out worktree in
this snapshot. In particular, the grant preparatory heads are branch references,
not the active contents of `owned-custom-capability/dax`. Sol is frozen, but
ownership has not silently transferred. The maintainer must explicitly assign
Opus a non-overlapping lane and separate branch/worktree before implementation.
No test processes are started or terminated by this documentation task.

## Safe recipient start after explicit lane assignment

1. Fetch and verify the published baseline by full SHA and ancestry. Create a
   new recipient-owned feature branch/worktree from
   `3c47d1a3045fa311bba4755d3aff8c5735e1baa2` (or this docs head, with the same
   runtime tree). Do not check out over Sol's or the maintainer's work. Do not
   use `a2cab737` as the base by accident.
2. Confirm the branch before any edits/install. Read the repo rules, this
   handover and the relevant producer/tests. Verify reported evidence yourself;
   another agent's report is not independent validation.
3. Explicitly select checksum-verified Bun 1.4.0, verify `--version`, run frozen
   installation and confirm manifests/lockfile are unchanged. Keep its directory
   first on PATH only for DAX development, with CI's existing 4 GiB Node heap
   for lint. Do not change global Bun, use `bun link`, regenerate the lockfile,
   or remove another project's node_modules to cure type discovery.
4. Use isolated DAX home/XDG state and owned test processes; retain logs outside
   test discovery. Focused tests should name explicit `./packages/...` files to
   avoid exported-control artifact discovery. Keep matching development binaries
   and journals together; preserve the installed release binary/user data.
5. Keep each remaining decision and implementation bounded, retain meaningful
   negative controls, convert an inverted gap check only when production proves
   the invariant, and pin pushed SHAs and exact-SHA platform evidence for Astra.
   Sol's current local results are not substitute independent review. Integration
   and any future release require the final comprehensive review and maintainer
   authorization; no additional closure is accepted by this document.
