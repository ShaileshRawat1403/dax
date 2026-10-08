# DAX current ownership and release work

## Published 2.0.0 — 2026-10-08

[DAX 2.0.0](https://github.com/ShaileshRawat1403/dax/releases/tag/v2.0.0) is
published at source/tag **87029cbd57dd16c330f677b8cc699c3404ecd45f**.
[Main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37717923118) and
[release gates/build/publication](https://github.com/ShaileshRawat1403/dax/actions/runs/37718917919)
passed. Main incorporated the reviewed stack by fast-forward. The original
sprint ledger has zero open entries within the documented supported scope.
The former session collector skips execute using owned persisted fixtures:
local macOS gates pass 2,401 tests with zero skips/failures; existing platform
exclusions are unchanged. All eleven published archive hashes match their
manifest/checksums, and a real disposable GitHub install reports 2.0.0.
[Publication evidence](tooling/evidence/release-2.0.0/published/README.md) records inventory, source and install results.

Reviewed plugin/local-MCP/worker/verifier executable bindings remain unsupported
and denied. Build-host-only Rust helpers, unknown historical coverage, same-user
access and bounded review limits remain explicit; no error-free claim is made.
v1.5.0/tag/assets and the operator-installed binary remain unchanged. Earlier
sections below are historical checkpoints, not current gap/release status.

## Final source with session fixtures — 2026-10-08

Source **87029cbd57dd16c330f677b8cc699c3404ecd45f** passes exact-source
Ubuntu/macOS/Windows CI and fresh tagged release-mode gates: 2,401 passed, zero
skips/failures on macOS. The two formerly skipped collectors now use owned
persisted fixtures; applicable platform exclusions elsewhere are unchanged.
[Updated evidence and source](tooling/release-2.0.0-final-checkpoint.md) retain
older failures and supported-scope limitations. The maintainer authorized Codex
to integrate, verify main CI and publish 2.0.0. These actions are in progress.
All earlier source checkpoints below are historical.

## Authorized 2.0.0 publication — 2026-10-08

The maintainer explicitly authorized Codex to fix the two skipped session
collector tests, update documentation, integrate main, verify CI, and tag/publish
2.0.0. This authorization is specific to this release; feature branches and
review/evidence discipline remain required. The two checks now own persisted
fixtures, reopen them through the real CLI bootstrap, and assert exact data plus
missing-record failures. No ambient lookup or catch-to-null skip remains. Final
source validation, integration and publication are in progress; v1.5.0 and the
installed binary remain unchanged until those actions succeed.

## Final release checkpoint — 2026-10-08

Runtime source **4d03493e94e7a8f6f78383bc44c9e610a861035e** passes
Ubuntu/macOS/Windows CI and fresh clean tagged-mode gates: 2,399 tests, two skips,
zero failures. [Final source, rebuilt artifacts and publication handoff](tooling/release-2.0.0-final-checkpoint.md)
record bounded separate-agent acceptance and retained failures. The MCP fixture
correction isolates slow setup from its unchanged authority-test deadline; the
underlying Windows delay remains unexplained. The candidate sprint ledger is empty
within documented scope, not an error-free or OS-isolation claim. Main integration,
post-merge CI and publication remain pending under the maintainer merge rule. Main,
v1.5.0, release assets and installed binary are unchanged. Dirty/unmerged worktrees
remain preserved. Earlier checkpoints below are historical.

## Release fixture reliability follow-up — 2026-10-07

The final receipt's Windows CI exposed a project-setup/test-deadline race before
MCP prompt dispatch. [The controlled reproduction and bounded fixture correction](tooling/release-2.0.0-operator-env-validation.md)
retain the failure; its underlying host-delay cause remains unknown. This is
test-only, with authority checks/deadlines unchanged. Corrected-source full gates
and platform CI remain required before final release handover. Main, v1.5.0 and
the installed binary remain unchanged. Earlier source checkpoints are historical.

## Final corrected release checkpoint — 2026-10-07

Source **2a75a430f2891cb8fd861a4d39c2a4fc3f94eef1** supersedes c064124.
Shell producers omit the documented operator environment keys after hooks; malformed
network URLs fail closed with 400. [Final validation and prepared artifacts](tooling/release-2.0.0-operator-env-validation.md)
record bounded separate-agent acceptance, 2,399 passing fresh-clone release-mode
tests and rebuilt installer/checksum controls. [Exact-source CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37649534987)
passed Ubuntu, macOS and Windows, including the actual CMD quote controls. The candidate sprint ledger is empty within its documented
scope; main still has eight until integration. This is not an error-free or OS
isolation claim. v1.5.0 and the installed binary remain unchanged. Main integration,
post-merge CI and publication remain pending. Earlier checkpoints below are historical.

## Release-ready source checkpoint — 2026-10-07

Prepared source **c06412458a12d8208457f339332f2f8195766e9c** on
`release/2.0.0-candidate` passed targeted correction reviews, full local gates,
all-platform CI, clean clone-only tagged release-mode gates and packaged installer
acceptance. [Final evidence and retained asset paths](tooling/release-2.0.0-validation.md)
record 2,392 passing tests, eleven verified archives and checksum refusal without
overwriting a prior test installation. The original sprint ledger is empty within
its documented scope, not a claim of defect freedom or unsupported executor support.
This documentation receipt is not the binary source. Maintainer integration and
publication remain pending; main, v1.5.0 and the operator's installed binary are
unchanged. Preserve dirty/unmerged checkouts and the prepared ignored assets.


## Release preparation — 2026-10-07

Version 2.0.0 is prepared on `release/2.0.0-candidate`, not published. Fresh
review found and reproduced an alternate project-approval path and missing OAuth
issuer call sites. [The corrections and validation](tooling/release-2.0.0-validation.md)
cover those findings, HTTP operator credentials and terminal control. The original
candidate sprint ledger remains empty within documented scope; it is not a claim
of defect freedom. [Migration and supported limits](product/release-2.0.0.md)
explicitly retain unavailable reviewed bindings, shared-secret identity limitations
and older-journal incompatibility. Final gates, packaging/installer checks and
exact-SHA CI are required before maintainer integration/publication. v1.5.0 and
the installed binary remain unchanged. Earlier dated sections are historical.


## Cold typechecks and platform diagnostics — 2026-10-07

The final candidate's Windows typecheck launcher exited without a compiler
diagnostic; that cause remains unknown. Cold checks independently reproduced
ambient types leaking from outside the checkout. [The bounded correction](tooling/checkout-local-typechecks-validation.md)
confines all workspaces to local type dependencies, streams and serializes the
shared typecheck gate, and lets all CI platforms finish independently. Cold checks
pass 5/5 without caches; full gates pass 2,383 tests. The actual macOS preview
build, CLI version/help and owned TUI startup/exit also pass. Exact-candidate CI
and integration remain pending. No installed binary or release changed.

## Final sprint candidate — 2026-10-07

The candidate ledger now has **zero remaining entries in the approved sprint
scope**; published main still has eight until final validation/integration.
[The final acceptance matrix](tooling/conformance-final-acceptance.md) explicitly
separates supported reviewed execution, unsupported denial/barriers and legacy
compatibility. It replaces the last two obsolete V1-as-V2 gap probes with actual
compiled reviewed-producer checks. Unsupported executable binding forms remain
feature backlog. This is not an error-free guarantee or a release claim.
Security checkpoint `9ddb2d6` passed Ubuntu/macOS/Windows CI, including Windows
RAO timing. Final candidate gates/CI and safe merged-branch cleanup remain.

The following dated sections preserve earlier checkpoints and counts; this
section supersedes their descriptions of current candidate progress.


## Sole ownership — 2026-10-05

The maintainer confirmed that no separate Astra reviewer is active and authorized
Codex to finish the remaining work with solo validation. Historical Astra
acceptances below retain their original scope; current corrections are not
independent cross-validation. Feature branches and exact-commit CI remain required.
The Windows reliability correction builds on D2 API correction `82440ca` and is
documented in [the lifecycle validation record](tooling/windows-lifecycle-validation.md).
It does not itself close an aggregate conformance gap or approve a release.
The bounded presentation correction separates live session activity from durable
run status; see [its validation record](tooling/workstation-live-activity-validation.md).
Its first CI run reproduced the older Windows cleanup/recovery timeouts. The
[follow-up correction](tooling/windows-timeout-cleanup-validation.md) retains
those failures, adds native Windows descendant checks and proves a cleanup
settlement race before correcting it.

## MCP OAuth issuer binding — 2026-10-07

A newly published SDK audit finding stopped the RAO checkpoint's CI before tests.
The [security correction](tooling/mcp-oauth-issuer-validation.md) upgrades the SDK,
preserves authorization-server issuer bindings and refuses historical unstamped
credentials. Configured clients require an explicit `oauth.expectedIssuer`; old
credential files remain intact but require reauthentication. Real SDK negative
controls detect the old provider. Final local gates pass 2,382 tests; the unchanged
high audit threshold passes. Exact-candidate platform CI and integration remain
required; published v1.5.0 and its installed binary are unchanged.

## Windows RAO persistence budget — 2026-10-07

The composite persistence/filtering fixture retains its three writes and exact
assertions, with phase timing and a bounded thirty-second deadline. Its prior
Windows five-second timeout is preserved; the underlying latency cause remains
unknown. [Validation and raw evidence](tooling/windows-rao-persistence-validation.md)
record 2,377 passing tests and complete local release gates. The preceding
compiled mediation checkpoint also passed all-platform CI. Final candidate CI,
ledger reconciliation and integration remain pending; no release is claimed.

## Remaining compiled mediation controls — 2026-10-06

Actual operator/command shell denials, @reference and attachment content reads,
and allowed-read/denied-write batch leaves now pass the compiled producer matrix.
[The acceptance record](tooling/compiled-final-mediation-validation.md) retains
full gates (2,377 passed). The debug checkpoint's Windows run exposed an unchanged
RAO filter-test timeout; that failure is retained for a separate correction.
The remaining grant ledger has older usable-binding wording that must be
reconciled explicitly with the approved safe-denial scope before any closure.
No merge or release is claimed.

## Explicit debug boundary — 2026-10-06

The real debug handler now proves its fresh context has no run authority and
uses the common no-contract lookup before its captured tool. It reports that
compatibility basis without creating a canonical run. See
[the validation record](tooling/debug-no-contract-boundary-validation.md).
Full gates pass 2,377 tests; the initial timeout is retained without a root-cause
claim. Exact-candidate CI and final inventory/ledger reconciliation remain.

## Session identity/authority integrity — 2026-10-06

Compiled probes reproduced model dispatch from corrupt ownership metadata and
bypass of a pending root's review through another root's governing pointer. The
[shared-reader correction](tooling/session-storage-identity-validation.md)
refuses before model requests or journal changes while preserving genuine derived
inheritance. All earlier failed validation attempts are retained. Final full
gates pass 2,377 tests; exact-candidate CI, debug boundary and final path inventory
remain required. No grant-gap closure or release is claimed.

## Compiled ask/remember acceptance — 2026-10-06

Actual MCP dispatch now waits for a real route-based operator decision. Remembered
approval permits the same tuple's second dispatch; another run asks again and
can be denied with zero server effects. [The acceptance record](tooling/compiled-grant-ask-validation.md)
retains the initial invalid fixture payload and final controls. Full gates pass
2,377 tests. Session metadata integrity and final path inventory remain under
audit; no grant-gap closure or release is claimed.

## Scoped SDLC verification correction — 2026-10-06

A compiled probe reproduced command execution when the verification helper was
given a reviewed session reference without a verifier grant. The
[shared-lookup correction](tooling/scoped-sdlc-verification-validation.md) denies
before inspection/launch and preserves real unscoped and bound-v1 operations.
Missing references cannot fall back. Full gates pass 2,377 tests; exact-candidate
CI and the final execution-path inventory remain required.

## Real interruption acceptance — 2026-10-06

A fixture-owned compiled process is now terminated during an actual pending
assistant dispatch. Fresh-process resume requires recovery, makes no model calls
and leaves the journal and messages unchanged. See
[the bounded acceptance record](tooling/compiled-process-interruption-validation.md).
Full local gates pass 2,377 tests; exact-candidate CI and final path inventory
remain required. This is not proof of every possible crash window.

The patched dependency/recovery checkpoint `ad39457` passed
[CI on all three platforms](https://github.com/ShaileshRawat1403/dax/actions/runs/37399785188),
including strict Windows recovery cleanup (165 ms). The original OS cause remains
unestablished. No merge or release; candidate grant gaps remain open.

## Compiled MCP acceptance — 2026-10-06

Actual SDK tool, resource and prompt calls now pass through the compiled reviewed
producer. Cross-server requests leave all three server effect counters at zero;
replay and journal privacy controls pass. See
[the acceptance record](tooling/compiled-mcp-producer-validation.md).
Full gates pass 2,377 tests. The later interruption slice supplies one real
OS-boundary control; exact-candidate CI and the final execution-path inventory
still block grant-gap closure and release readiness.

## Dependency audit correction candidate — 2026-10-06

New high/critical advisories stopped hosted validation before tests. The bounded
[dependency correction](tooling/serialization-proxy-dependency-validation.md)
resolves proxy-addr 2.0.8 and Seroval 1.6.8 and passes the existing high-threshold
lock audit. A fresh frozen install and all release gates passed, including
2,377 Bun tests. Exact-commit platform CI is still required before integration.

## Recovery fixture correction — 2026-10-06

A Windows recovery hook timeout is retained. The test now owns its project,
awaits strict cleanup and records teardown timing; full gates pass 2,377 tests.
See [the validation record](tooling/recovery-owned-fixture-validation.md).
Windows hosted acceptance remains pending. New dependency advisories blocked
CI before tests and require a separate patched dependency candidate.

## Compiled delegation correction — 2026-10-06

Real compiled TaskTool acceptance found and corrected child-turn ordering and
undefined model metadata in the returned JSON result. Fresh dispatch, same-child
resume and granted-but-unavailable-agent refusal pass; see
[the validation record](tooling/delegated-producer-validation.md). Full gates
passed 2,377 tests; final strengthened focused controls passed 13 tests.
No gap closure or release is added. Actual MCP and interruption acceptance remain.

## Shared action reference correction — 2026-10-05

Three production context-read controls reproduced fallback from missing/malformed
governing contracts or mismatched session ownership. [The correction](tooling/action-governing-reference-validation.md)
refuses those effects before entering compatibility while preserving valid v1
shadow-write isolation. Full gates pass 2,377 tests. No grant or aggregate gap
closure is added; two candidate grant gaps and the final coverage audit remain.

## Task-graph authority correction — 2026-10-05

Production graph dispatch previously selected an identity without consulting
reviewed grants. [The bounded correction and reproduced controls](tooling/graph-reviewed-authority-validation.md)
mediate root and inherited child dispatch through the shared resolver; a genuine
compiled producer records durable denials before effects. Missing session or
explicit governing-contract data cannot restore legacy execution. Final full gates
pass 2,374 tests. The preceding settings compatibility correction passed
[Ubuntu/macOS/Windows](https://github.com/ShaileshRawat1403/dax/actions/runs/37316385756).
No additional gap closure is claimed; two candidate grant gaps remain.

## Legacy settings compatibility correction — 2026-10-05

A real command control exposed new snapshot limits incorrectly constraining
historical SQL preferences. [The bounded correction](tooling/project-settings-legacy-compatibility.md)
keeps old data intact and commits its complete population; only reviewed new
snapshots receive the new limits. Current full gates pass 2,367 tests. The preceding
Agent lifecycle correction passed [all three platforms](https://github.com/ShaileshRawat1403/dax/actions/runs/37314994417).
There is no additional gap closure; two candidate grant gaps remain.

## Agent import lifecycle correction — 2026-10-05

Settings candidate CI passed Ubuntu/macOS but Windows hit the unchanged Agent
cold-import callback deadline. [The correction and retained failure](tooling/agent-import-lifecycle-validation.md)
move normal module loading to discovery and add a separately owned bounded cold
import probe. It changes no production behavior and claims no new gap closure.
The Windows slowdown's underlying cause remains unestablished.

## Project-settings authority candidate — 2026-10-05

Explicit operator adoption now switches effective preference, constraint and risk
readers to the project journal. Legacy projects stay unchanged; enrolled legacy
writes refuse and explain exact-digest review. Concurrent replacements, stale
legacy/predecessor inputs, denial, failed publication/retry, restart, source-run
retention and malformed-authority controls pass. The scope tracking check now
uses production transitions rather than source-text guesses. This proposes
closure of `scope.project-journal`, leaving two candidate grant gaps; accepted
published main remains eight pending complete integration. Current validation is
recorded [here](tooling/project-settings-validation.md). Settings grant no execution
authority. Historical SQL data is preserved and not silently promoted.

## Operator-reviewed memory candidate — 2026-10-05

The feature candidate now exposes protected project-fact proposal, exact-digest
operator review, and durable publication. Fresh production intent reads approved
journal memory; retirement removes it from subsequent sessions. Candidate memory
closure leaves three candidate gaps: contract grants, shared enforcement, and
remaining project-journal production integration. Published main still has eight
accepted gaps. Legacy SQL preferences and constraints are not migrated or promoted.
See [the producer protocol and validation](tooling/project-memory-producer-validation.md).
There is no new memory UI, release, or main integration in this slice.

## Convention consumer candidate — 2026-10-05

Approved project conventions now reach the production provider-adapter system
input, with explicit prompt provenance and retirement/malformed-authority
controls. [Validation and compatibility](tooling/project-conventions-validation.md)
record the boundary. This does not propose another aggregate closure; the
candidate ledger remains three and accepted main remains eight.
The memory producer at `b4795c0` and retention correction at `008f633` both passed
exact-commit CI on Ubuntu, macOS, and Windows:
[producer](https://github.com/ShaileshRawat1403/dax/actions/runs/37257787807),
[retention retry](https://github.com/ShaileshRawat1403/dax/actions/runs/37258212016).

## Execution ownership — 2026-10-04

The maintainer transferred the remaining conformance implementation to Codex. Astra
remains the architecture and merge reviewer. Claude Opus 5.5's implementation is frozen;
its [handover](HANDOVER_OPUS_TO_CODEX.md) records the branch state, the slice-to-SHA map,
the remaining gaps, the stage 4d design and its mandatory controls, and the execution
order from here.

| Role | Holder | Branch and worktree |
| --- | --- | --- |
| Implementer | Codex (Sol) | `feat/conformance-closeout`, exclusive managed worktree `conformance-closeout/dax`, from `18226c22dab1bb6d07d3a867a8ce8f2bd8334a3d` |
| Reviewer | Astra | Architecture and adversarial review of exact SHAs |
| Independent reviewer, on request | Claude Opus 5.5 | Reviews Codex's authority changes when the maintainer relays them; never its own commits |
| Frozen | Claude Opus 5.5 | `feat/conformance-execution-opus` at its handover commit; last implementation head `32b2f34fc9dc3d78d20b4a9a29606f6e1a726309` |
| Frozen | Sol | Existing branches preserved and Sol-owned |

Astra approved the [Stage 4d architecture](roadmap/GRANT_STAGE4D_PROPOSAL.md)
at exact `0925ab3cc3d34b68875c415d696761ed00caaaeb` and authorized bounded D1
implementation: the common compiled-image/publication gate, typed governing reads,
strict v1 writes and genuine compiled root producer controls. Astra accepted D1
at exact `f2484a2f6131494d82a734b9e2326496e673f2c2` with independent 50 tests /
223 assertions and all three CI platforms green; the retained
[D1 review](tooling/grant-stage4d-d1-astra-review.md) records provenance. D2 is
authorized after Astra accepted the bounded reviewed-creation correction at
`7fc5cd14f2719ce54ef603c462cfe1efb9b083d5`: independent 32 tests / 190 assertions
and exact three-platform CI passed. The retained
[creation review](tooling/grant-stage4d-reservation-astra-review.md) records that
bounded acceptance. D2 operator routes, complete-pinned revision/start transactions,
initial-claim entry guards and approval routing are candidate implementation work;
full gates, exact-SHA CI and independent D2 review remain outstanding. SDK generation
must remain additive and preserve accepted client runtime templates. The inherited dependency foundation
`d2ef0b0..3c47d1a`, inspected in final context
`32b2f34fc9dc3d78d20b4a9a29606f6e1a726309`, received bounded C1 acceptance
(185 regressions and two independent journal controls); this is not blanket gap,
project-journal integration or release acceptance.

No merge, user-profile activation, release, installed-binary replacement or gap
closure is authorized. Published `main` (`d2ef0b0`), v1.5.0 and its frozen evidence
remain unchanged; `main` records eight open gaps. The older status sections below
are preserved history, superseded by this bounded architecture approval.

The section below is the record of the previous arrangement, kept as written.

## Execution ownership — 2026-09-30

The maintainer transferred implementation of the remaining conformance work to
Claude Opus 5.5. Astra remains the architecture and merge reviewer. Sol's
implementation is frozen.

| Role | Holder | Branch and worktree |
| --- | --- | --- |
| Implementer | Claude Opus 5.5 | `feat/conformance-execution-opus`, from `3c47d1a3045fa311bba4755d3aff8c5735e1baa2`, in `.claude/worktrees/conformance-execution-opus` |
| Reviewer | Astra | Reviews authority boundaries and adversarial controls, then corrective diffs on revalidation |
| Frozen | Sol | Existing branches preserved and Sol-owned; handover on `docs/sol-to-opus-handover` at `8c032805c6db25b0733c3ed47470579c0c903036` |

Work proceeds in this order: capability vocabulary and properties, contract grants
and shared enforcement, project-journal production integration, governed memory.
The [entry-point audit](roadmap/CAPABILITY_ENTRY_POINT_AUDIT.md) records the first
workstream's scope decisions and findings. No merge happens until Astra accepts an
exact candidate SHA. No release or installed-binary replacement is authorized.
Published `main`, v1.5.0 and its frozen evidence are unchanged. The preparatory
grant work at `a2cab7370582f96f8a70978994f92ad11de3423a` is outside the baseline
and is not integrated or approved.

The sections below are the record up to the handover. Where they name Sol as the
implementer or say no Claude lane is assigned, this section supersedes them.

## Record before the 2026-09-30 handover

Codex retains DAX ownership after Claude's withdrawal on 2026-09-19. The current
conformance sprint uses Sol for implementation and Astra 6 high for architecture
and adversarial review.
The [original handover](HANDOVER_CLAUDE_TO_CODEX.md) is preserved verbatim; this
record supersedes its status and open findings. Work remains on feature branches;
earlier integration authorizations applied to individually approved checkpoints.
Current gap-closure candidates stay on owned feature branches until Astra's
final comprehensive review; solo validation does not authorize integration.

## Candidate work and review cadence — 2026-09-30

The maintainer authorized continued bounded implementation of the eight remaining
gaps without intermediate architecture waits. Astra will review the complete
candidate before integration or a future release. Published `main` remains at
`d2ef0b0f510c70df29d3855f399e02902fbe4014`, with **eight accepted open gaps**.
The feature-stack ledger is a candidate measurement, not an accepted main claim.
The 2026-10-05 caller-registration descriptor correction additionally proposes
closure of capability vocabulary and intrinsic properties. Four candidate
entries remain: contract grants, shared enforcement, project-journal production
integration and governed memory. Accepted main still has eight open gaps.
See [current coverage evidence](tooling/legacy-runtime-descriptors-validation.md).
The next candidate routes fresh intent memory through approved project-journal
facts, with [reader validation](tooling/project-memory-reader-validation.md).
Operator promotion and broader PM migration remain unfinished; no additional
gap closure is claimed.
The [run-envelope cutover record](tooling/run-envelope-cutover-validation.md)
documents proposed closure of the journal primitive and scope-aware envelope
entries; the later descriptor correction leaves four candidate entries. Contract grants/enforcement and governed
project-memory production are not complete; no claim of eight-gap closure is made.

Claude Opus 5.5 is expected to join collaboration at the maintainer's request.
No Claude implementation lane or worktree has been assigned yet. Sol retains
ownership of the current branches; activate the multi-agent SOP with separate
worktrees and non-overlapping ownership before Claude makes changes. Historical
handover evidence remains intact. v1.5.0, release assets and the installed binary
remain unchanged.

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

At the historical pause checkpoint, the [conformance sprint plan](roadmap/CONFORMANCE_SPRINT.md), linked from the
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
remaining aggregate gaps were explicitly deferred during the maintainer's absence.

## Resumed conformance work — 2026-09-26

The maintainer has resumed conformance work from published source `main` at
`0170d2f8137bbd0abab7d9f6d72837ca5cec59f0`, verified by fetch and clean
local/remote parity. The Explore reply-visibility correction is integrated;
[exact-SHA main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36222148982)
passed on Ubuntu, macOS, and Windows. The maintainer confirmed a fresh interactive
Explore greeting and `--continue` reopen displayed the same persisted reply.
These source changes remain unreleased: published v1.5.0, its assets, and the
installed binary are unchanged.

All **eight aggregate gaps remain open**; scoped record-class coverage remains
**11/11**, and `inv1.record-classes` remains closed. Sol implements bounded
slices; Astra reviews architecture and every Tier 2 change before integration.
The [capability registry proposal](roadmap/CAPABILITY_REGISTRY_PROPOSAL.md) received
Astra's architecture approval for a native-only implementation slice. Astra accepted
the corrected implementation at `d2ef0b0f510c70df29d3855f399e02902fbe4014`, now
integrated and published on `main`. [Post-integration CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36293195364)
passed on Ubuntu, macOS, and Windows at that exact SHA. This adds strict descriptive
native enrollment and executor binding, not execution authority. Sol's next
[plugin/MCP tool-identity proposal](roadmap/PLUGIN_MCP_CAPABILITY_PROPOSAL.md)
has Astra's architecture approval for loader-backed tools, with custom registration
kept compatible and unenrolled. Plugin and MCP delivery use separate commits and
independently runnable tests. While Astra is temporarily unavailable, the maintainer
authorized Sol to continue bounded implementation but keep validated feature
branches for later independent review; this does not authorize integration or release.
Runtime integration still requires Astra's review. Operator/workflow
and worker/context enrollment remain separate followups. No additional gap is
closed. Planned order is capability vocabulary
and intrinsic properties, contract grants, shared enforcement, scoped journals,
project journal, then governed memory promotion. Models cannot authorize durable
memory promotion. An empty ledger would not itself approve a release; installation,
compatibility, recovery, and real user-flow acceptance still require evidence.

The first plugin delivery is implemented on `feat/plugin-capability-identity`
for Tier 2 review, not integrated. Its [validation record](tooling/plugin-capability-identity-validation.md)
describes actual loader, prompt, batch and debug controls, atomic catalog
publication, post-approval identity checks, and operator collision reporting.
It keeps `register(tool)` compatible and unenrolled. This plugin work is
preserved at `051c1752ae7842c6bb99ed1e121c13832ab6449f`, with
[green exact-SHA CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36320660779).
The separate `feat/mcp-capability-identity` branch builds on it and adds real
HTTP/stdio MCP enrollment, ordered discovery, client invalidation and guarded
session wrapping. Its [candidate validation record](tooling/mcp-capability-identity-validation.md)
states the evidence and exclusions; neither delivery is integrated or independently
accepted. All eight aggregate gaps remain open.

The [native-slice validation record](tooling/native-capability-registry-validation.md)
records production dispatch controls, passing final-source local gates, retained
earlier failures and the unchanged debug authority limitation.

The initial registry does not implement grants, shared grant enforcement,
contract migration, or a new no-contract policy. Existing v1 and no-contract
behavior, approval, sandbox, scope, and verification checks remain in force.
The proposal's successor-run requirement for legacy consequential execution still
needs later operator-flow approval; architecture approval did not authorize it.

The post-greeting Running/Brooding label is a separate unresolved observation,
not an established cause of reply visibility or part of that correction. Earlier
intermittent relay-test failures and the macOS approval-wait failure remain
unexplained; preserve their historical evidence and do not assert a root cause.

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

## Historical pause checkpoint and development setup

The checkpoint merges the approved status documentation at
`c10f48f9887968535500f7128c1f37508cd972ab` and home UI at
`9e245b839f9cf0871a18cb4194533789298587e3`, retaining the UI branch's design
ancestor `a8043169adb35a7fcc9e73967bf31160581d2835`. At that checkpoint, the only runtime change
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
For each resumed slice: fetch `main`, confirm its integration and clean parity,
read this status and the eight open ledger entries,
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
