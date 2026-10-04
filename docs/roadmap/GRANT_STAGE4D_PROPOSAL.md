# Grant stage 4d: executable reviewed runs and remaining conformance work

Proposal for architecture review, recorded 2026-10-04. Implementer: Codex.
Reviewer: Astra. Base: `18226c22dab1bb6d07d3a867a8ce8f2bd8334a3d`.
Branch: `feat/conformance-closeout`, owned only by this implementer.
Architecture approved by Astra at exact `0925ab3cc3d34b68875c415d696761ed00caaaeb`.
D1 implementation alone is authorized; D2 exposure waits for exact-SHA D1 review.
This proposal closes no gap and authorizes no user-profile activation. Merge remains maintainer-owned.

Builds on [stage 4](GRANT_STAGE4_PROPOSAL.md), its accepted amendments,
[stage 3](GRANT_STAGE3_PROPOSAL.md), the
[compatibility design](GRANT_COMPATIBILITY_DESIGN.md), and the
[Opus handover](../HANDOVER_OPUS_TO_CODEX.md). DAX remains the standalone execution
and approval authority. No companion repository changes are needed.

## 1. Evidence at the base

All source paths below are relative to `packages/dax/src`; function names anchor
claims to the base above rather than to moving line numbers.

| Current production boundary | Evidence | Consequence for 4d |
| --- | --- | --- |
| Review existence blocks execution regardless of state | `execution/grant-review-barrier.ts`: `assertNoGrantReview`, `hasGrantReview` | Preserve presence detection and writer barrier; add a distinct executable-authority check |
| Guardian accepts only v1 | `execution/contract-guardian.ts`: `readContract`, `writeContractIfNotStarted`; `execution/execution-contract.ts`: `ExecutionContract` | Reviewed reads need a proven v2 branch; ordinary writes must stay v1-only |
| All session entry points check before effects | `session/prompt.ts`: `assertSessionExecutable`, used by `prompt`, `loop`, `command`, `shell` | Replace the executable check centrally, keeping its position before messages, reads, commands, processes and model calls |
| Reviewed birth is an internal factory only | `execution/run-factory.ts`: `createGrantReviewedRun` | Expose one explicit opt-in through the existing creation surface |
| Generic create starts v1; explicit legacy fallback can downgrade factory failure | `server/run-gateway.ts`: `createRun`; `server/run-contract.ts`: `CreateRunRequest` | Reviewed creation must branch before that fallback and reject combining the modes |
| Approval routes exist; review inspection/revision/start routes do not | `server/routes/run.ts`; `server/run-gateway.ts`: `resolveApproval` | Add missing run-scoped operations; reuse approval resolution |
| Publication/activation proof exists, but activation lifts nothing | `capability/grant-review.ts`: `publish`, `readPublished`, `activate`, `dispatchAuthority` | Reuse journal proof, artifact validation and fresh binding checks; add a common enforcing-image gate |
| Tool/action dispatch already consumes activated review authority internally | `execution/native-settlement.ts`: `beginNativeInvocation`; `capability/record-resolution.ts`; `session/operator-shell-authority.ts` | No second lookup or fallback authority; ensure all three and guardian/session entry share the same gate |
| Native birth accepts only an active canonical run | `session/prompt.ts`: `ensureCanonicalRunBirth` | A reviewed start must reach running through canonical transitions before prompt dispatch |
| Model stop is already a completion candidate | `execution/native-completion.ts`: `adjudicateNativeCompletionCandidate`; `session/prompt.ts`: `surfaceRejectedNativeCompletion` | Retain canonical adjudication; never manufacture completed from idle or a stop |
| Workstation panel manufactures busy from run status | `cli/cmd/tui/routes/session/index.tsx`: `workstationState`, `sessionStatusType: summary.status === "running" ? "busy" : "idle"` | Show live session activity separately from durable run state |
| Project journal exists here, production PM uses SQLite | `state/events/project-journal.ts`; `pm/index.ts`; `tool/pm_note.ts`; `dax/memory/index.ts` | Review existing journal before migration; no closure from primitive existence |

The inherited stack `d2ef0b0..3c47d1a` was inspected in the final Opus context
`32b2f34` by Astra, who reported no blocking finding in the inspected production
changes, 185 passing regressions, and two independent journal controls. This
clears the inspected dependency audit for 4d design, not blanket gap/release
acceptance. Astra accepted this bounded C1 dependency foundation before D1 at
`32b2f34fc9dc3d78d20b4a9a29606f6e1a726309`; retained reviewer evidence below names
185 regressions (752 assertions), two independent journal controls, and the
separate 38 final-context controls. This is independent reviewer evidence,
not implementer self-review or acceptance of project-journal integration.
Acceptance of an Opus slice does not by itself accept that stack. Main still has eight open
gaps; the six-entry feature ledger and its two removed entries are candidates.
Its grant-gap prose predates the delivered inactive enforcement and must be
corrected only as reviewed status, without claiming closure.

D1 review-presence refinement approved by Astra: read the shared journal with
its strict owner/schema/sequence/event-ID checks and reducer to establish only
review presence or absence, without consulting the separate authority marker.
A readable non-review journal preserves existing v1 shadow-action failure
isolation when that marker is unreadable. A readable reviewed journal still
blocks a lost private record, even with an old valid v1 artifact; a corrupt or
unreadable journal cannot prove absence. This presence check never authorizes
execution: the reviewed loader still requires the readable canonical marker,
full envelope recipe, publication/activation equality and current bindings.

## 2. Proposed smallest production opt-in

This exposure is an explicit extension to the previously approved Stage 4 scope,
which kept opt-in exposure separate. D1 lifts the barrier without exposing the
factory; D2 needs acceptance of this operator API boundary before exposure.

Use the existing `POST /runs` creation surface. Add an optional, strict
`capabilityReview` object with required `mode: "reviewed_grants"`. Absence preserves
the existing request/response and v1 factory path. There is no global setting,
automatic upgrade, ordinary-chat review prompt, or companion-only interface.

Its optional operator inputs are the existing proposal concepts: filesystem
roots, acknowledged external subject keys, MCP source selections, ask subjects,
and explicitly named delegation agents. Root authorship is proposal input;
the digest-bound review approval is what confirms the proposed scopes. The model
cannot populate acknowledgement or approval on the operator's behalf. Accept
structured inputs, never a caller-authored v2 contract or implementation binding.
An optional `successorOf` identifies an old session/run for display only (section 6).

Reviewed mode combined with `metadata.allowLegacyFallback: true` is invalid before
creating a session. Reviewed creation errors never enter the legacy fallback.
Initially support `workflowHint: "generic"` only; require it explicitly for this
mode and reject other hints before creating authority. This bounded native model
path avoids implying that 4d completes workflow/worker/verification support.
Reject a compiled candidate that requires a worker or verification, including
inferred requirements; keep `GrantReview.activate`'s existing refusal as defense
in depth. No requirement is weakened to make a run start.

Generic is a workflow boundary, not a read-only policy. The existing compiler can
retain native write/edit/shell tools for a neutral intent without requiring
verification. Explicit reviewed filesystem roots can therefore propose
consequential grants; inspection must show them before the exact grant set is
approved. Preserve the compiler, permissions and postconditions; never infer
read-only authority from `verificationRequired: false`.

Creation calls `createGrantReviewedRun`, persists ordinary run metadata, and
returns the ordinary run identity/status plus an optional review summary:
revision, approval ID, proposal digest, contract digest, binding-manifest digest,
and review location.
The actual canonical status is waiting_approval; creation dispatches no prompt.
Canonical reviewed birth/queue and private reservation precede session creation;
the session is explicitly governed at birth. Discovery may load
trusted plugins or connect/start configured MCP clients to describe the catalog;
creation is not claimed to perform zero external initialization. No task/tool
invocation, resource read, prompt fetch, or workflow effect starts from creation.

Add only these run-scoped operations:

| Operation | Proposed contract | Behavior |
| --- | --- | --- |
| `GET /runs/:runID/grant-review` | Current review revision, exact approval subject, grants/scopes, bindings/attestations, exclusions, needsScope, needsTrust, unbindable, onDemandSources and publication/activation state | A read-only review view. Shows actual authority limits and external trust. Carries no secret header/environment values; does not invent or expose private MCP resource/prompt names |
| `POST /runs/:runID/grant-review/revisions` | Expected current revision/proposal/contract/binding-manifest digests plus updated structured operator inputs | Recapture and propose server-side, then `GrantReview.revise`; supersede the old request. Serialize the expected-state check with revision mutation. Published reviews remain final |
| Existing `POST /runs/:runID/approvals/:approvalID` | Existing named actor/decision; optional `remember: true` permitted only for an approved `capability_grant_ask` | Review approval records the exact existing subject and dispatches nothing. Ask approval calls `answerGrantAsk`; always records only the exact tuple. Reject remember on other approval types or denial |
| `POST /runs/:runID/grant-review/start` | Expected revision, approval ID, proposal digest, contract digest and binding-manifest digest | Publish the approved current subject, verify activation and enforcing runtime, claim start canonically, then dispatch the generic root prompt once |

The binding-manifest digest is a canonical commitment to the complete ordered
publication bindings (subject, attestation, binding digest, decision and delegation
agents). Inspection returns it; revision/start compare it to the approval subject,
stored revision and journal proof under the same mutation lock. A single matching
grant digest cannot substitute for a changed manifest. No caller-provided binding
material becomes authority.

Validate a nonblank actor, the approval type, decision and remember combination
before any approval append. An invalid request must leave no approved history,
including when a remember flag is rejected. Existing approval requests outside
reviewed mode retain their compatibility behavior.

Keep `resumeCanonicalWorkflowApproval` from treating grant review/ask approvals as
ordinary workflow-resume triggers. Grant approval and start are distinct actions.
No unrequested CLI/TUI wizard is necessary for initial API usability. OpenAPI and
SDK representations of these additive fields/routes must be updated with the
implementation; approval inspection must show the committed subject before start.
The actor is a named actor at the existing approval boundary, not new authentication.

## 3. One executable-authority gate

Keep `assertNoGrantReview` as the strict v1 write barrier and keep `hasGrantReview`
as a presence test. Do not redefine presence as "currently blocked": callers
also use it to distinguish reviewed semantics (TaskTool and MCP v2 reads).

Introduce one shared reviewed-authority loader/check, reused by
`GrantReview.dispatchAuthority`, the guardian's reviewed read branch and
`assertSessionExecutable`. An absent review takes the unchanged v1/no-contract
path. A present or unreadable review can never yield null/no-contract authority.
A reviewed read succeeds only when:

1. The running image is a compiled DAX image with a valid native image identity
   and this build supports enforcement. Source/unknown images fail even if the
   proposed grant set contains only remote MCP. The support predicate lives in
   code; configuration and requests cannot switch it on.
2. Canonical journal replay proves complete publication and activation of the
   same revision/contract digest/bindings, without malformed or uncertain history.
3. `readPublished` validates the artifact against that journal proof, including
   run/contract identity and canonical contract commitment.
4. The current image matches every published native binding. A process restart
   into another image cannot inherit native grants from old activation. A compiled
   enforcing image with only unchanged remote grants remains valid because it
   inherits no native binding.
   Remote source changes still deny their affected actions at dispatch; start
   checks every binding, as already required. Do not recapture/connect all MCP
   sources on every guardian read.

Executable reviewed session/dispatch entry requires canonical `startedAt` as
well as running/waiting-approval state. Activated queued or never-started
waiting-approval rows remain inspectable but cannot produce model, message or
action effects. Administrative start uses the read-only proven loader before
claiming `execution_started`; only then may it dispatch the root prompt.

Terminal runs retain readable proven contract/evidence but cannot dispatch new
work. Session executability additionally requires permitted canonical lifecycle
state; a start uses queued state, and model dispatch uses running. Authority reads
must not prevent inspection of terminal evidence or reinterpret it as ungoverned.

Keep v1 `ExecutionContract` schema/compiler/writer behavior. Add an explicit
`GoverningExecutionContract = ExecutionContract | ExecutionContractV2` for reads
and consumers of shared policy fields. Validate v2 only through the reviewed
branch; never simply make arbitrary v2 artifacts valid ordinary contracts.
Update dependent type signatures deliberately, with no cast around v1 validation.
Writing a v1 contract to any reviewed run stays refused, activated included.
Fail closed on corruption, absence of explicit governing authority, journal or
artifact read failure, binding unavailability, append failure and unknown states.

The action's shared lookup remains necessary and permissions/runtime guard remain
necessary. Every denied action performs zero corresponding executor effects.
Dispatch-time binding change denies that action; it does not mutate/revoke the
published contract or invent a terminal failure for the whole run.

## 4. Start serialization and interrupted work

Use a cross-process start lock scoped to this run, separate from review/event
locks; acquire start, then review operations, then event operations. Never hold
an event lock while invoking an operation that appends events under that lock.
Revision/start races must resolve against one current committed subject under
the review lock, not a GET snapshot checked outside the mutation.

Under the start lock, check the request commitments, lifecycle and runtime gate;
publish from the exact journaled approval subject; activate using the existing
fresh capture; move the queued run to running with `execution_started`. That
canonical transition is the durable first-dispatch claim. Release the start lock
before invoking `SessionPrompt.prompt` with the published intent and existing
completion-candidate adjudication. Build prompt context from shared policy fields
plus reviewed grants as informative model context; context never authorizes.

A repeated start after running/terminal returns a typed refusal/current-state
result and initiates no prompt. Competing starts may publish/activate at most once
and only one may claim the initial dispatch. If activation exists but the run is
still queued, an explicit start may continue only after fresh validation of all
published bindings and proof; it records no duplicate activation. Do not treat
`already_activated` as blanket permission to dispatch.

Crash before publication proof: barrier remains, a new revision/review is
required. Crash after proof: use existing deterministic roll-forward. Crash after
activation but before start: the queued case above. Crash after execution_started
but before prompt: retain the claimed start and require recovery inspection;
retry never automatically dispatches. Crash during an effect: preserve existing
uncertainty/recovery rules, never infer success or retry it from an idle session.
This is at most one automatic initial dispatch, not an exactly-once effect promise.

Actual prompt rejection drives the existing canonical failure transition as
`startExecution` does; an administrative refusal before dispatch leaves the
nonterminal review state intact and returns a useful reason. Controls must cover
all these windows and concurrent start/revise requests.

## 5. Session activity and run truth

Use existing `SessionStatus` (idle/busy/retry/delayed) for animation, Brooding and
active-turn indicators. Stop deriving busy from `RunSummary.status`. Present a
separate durable run status from canonical projection. For a live idle session
whose run remains running, show "Idle · run open" or equivalent clear text;
waiting approval and terminal statuses remain explicit. Reconnect defaults to
idle until current session activity is fetched, rather than inferring a live
provider from a durable journal status.

Do not change completion authority to repair a label. Provider stop only proposes
completion to `adjudicateNativeCompletionCandidate`, which still requires stored
assistant settlement, invocation results, approvals, required artifacts and
verification. Interactive turns can become idle with their run open. A reviewed
single-shot start may complete only through accepted canonical adjudication.
Completion refusal remains visible to the operator/CLI. Reopening a completed
run cannot mutate it back to running.

## 6. Explicit successor for legacy consequential work

When an operator wants legacy/v1 work to continue under reviewed grants, create
an explicit new reviewed run with a fresh session ID, contract ID, review, grants
and activation. `successorOf` is a validated display/provenance link to the old
session/run, stored in run metadata; it grants nothing and is never a governing
run reference. Copy no old approval, remembered always, grant, activation or
execution state. The operator supplies the intended work/context explicitly.
No implicit continuation of old tools or pending effects is dispatched.

Keep old authority immutable; never upgrade its schema, relabel old receipts,
rebind a derived session away from its governing run, or transplant a child with
`task_id`. Ordinary v1/no-contract entry points keep their existing behavior.
This explicit transition does not retroactively prohibit every legacy request;
such a migration mandate would require a separate compatibility decision.
A refused old consequential continuation must direct the operator to this new
reviewed-run path, never silently create or execute a successor.

## 7. Required compiled producer acceptance

Build one hermetic compiled integration harness from real production modules at
the candidate source SHA using pinned Bun. Exercise the real Hono run routes,
`RunGateway`, factory, guardian, `SessionPrompt`, tool wrappers, `TaskTool`, MCP
HTTP transport, approval routes and journal replay. Use a deterministic local
HTTP model endpoint and a local HTTP MCP fixture classified as remote MCP;
the operator explicitly acknowledges its external trust. Isolate app/XDG homes,
ports and processes. Compile the same producer harness with a differing bundle
for changed-image/restart controls with native bindings. A different compiled
enforcing image can retain unchanged external-only grants; source/unknown
images still cannot execute an external-only reviewed contract. Do not substitute `daxExecutable`, guardian,
barrier or dispatch functions, manually seed activation as the success path, or
claim helper-only compiled probes prove production dispatch.

| Producer control | Positive evidence | Required negative evidence |
| --- | --- | --- |
| Creation/review/start | Route creates waiting review; exact subject approval/start yields published v2 authority and journal-backed effects | No opt-in preserves v1; fallback conflict rejected; source/unknown image, worker/required verification refused before execution |
| MCP tool model turn | Real `SessionPrompt` model tool call invokes a granted MCP tool; invocation/resolution/authorization/result replay coherently | Ungranted tool on same server runs zero times; cross-server source and stale definition deny; permissions/guard still deny a granted tool |
| MCP resource attachment | Real `createUserMessage` path reads a granted resource under v2 identity | Ungranted/cross-server read never calls `readResource`; v1-only source cannot cover reviewed read; events contain no URI/private item name |
| MCP prompt command | Real `command` path fetches a granted prompt | Ungranted/cross-server never calls `getPrompt`; v1-only identity denied; private name absent from journal |
| Ask approve/deny/timeout/always | Resolve through approval routes, named actor and deadline; always covers later same tuple | Deny/timeout/late or anonymous approval no effect; changed binding while waiting denies; another grant/capability/contract/binding/run cannot reuse always |
| TaskTool agent selection | Real approved agent creates exactly that child and records delegation before child dispatch | Unknown requested agent has no fallback child and no delegation receipt; agent missing after review fails safely |
| Child dispatch and resume | Child resolves the parent's activation and same grants, with child permission/tool filters allowed to narrow it; same-run `task_id` keeps binding | Child cannot dispatch what parent lacks, create a v1 run, change agent selection, widen permission or resume another run's child; no child effect on rejection |
| Every barrier state | Only valid publication + activation + enforcing image executes | Reserved, pending, denied, expired, superseded, interrupted intent without proof, unpublished, unactivated, corrupt/stale artifact, proof mismatch, unreadable authority, source/unknown images and changed images with native bindings all block |
| Start and recovery windows | Exactly one initial dispatch claim; proof roll-forward and queued activation recovery remain explicit | Concurrent/repeated starts spawn no second prompt; revision/start race cannot approve stale state; claimed start/effect uncertainty never auto-retries |
| Existing denials/compatibility | Stage 1–4 regressions and every legacy table row still pass; v1 read/replay/no-contract unchanged | Blocked aliases under any grant, unenrolled reviewed executor, out-of-run graph/debug paths, failed append and missing explicit governing contract remain denied |
| Activity/completion | Idle live session with open run has idle activity and durable nonterminal status; accepted adjudication alone completes | Stop with missing/denied invocation, pending approval or unmet outputs does not complete; reopen never fabricates busy/terminal truth |

Keep helper/reducer tests as narrower controls, including forged v1 read identities;
producer tests must demonstrate actual effects/counters and independent replay.
Add independent malformed/scope controls: corrupt owner/sequence/contract/run
references, reordered or edited binding manifests, source-selector mismatch,
delegation agent mismatch, filesystem targets outside reviewed roots and forged
resolution/authorization chains.
Any required row not runnable or passed remains an explicit acceptance blocker.
Real external-service implementation attestation is not claimed by an HTTP fixture.

## 8. Binding boundary and honest closure criteria

The currently accepted forms remain compiled running-image native capabilities
(exact under the existing bundle/runtime-revision method) and explicitly
acknowledged remote MCP (external). Headers' values, runtime machine code and
remote server internals are not attested. Generic native shell grants bind DAX's
shell dispatcher, not every program it can launch; scope stays opaque and existing
permissions/guard apply. This does not establish a verification-command binding.

| Unresolved family | Safe disposition now | Smallest candidate for later design, not an accepted form |
| --- | --- | --- |
| Plugins/loader modules | No grant; load/trust hooks remain a separate limitation | A separately compiled, immutable module image with a proven complete embedded dependency closure and exact dispatch handle; arbitrary imports/packages remain excluded |
| Local MCP | No grant; discovery launch description authorizes nothing | A deliberately built immutable self-contained server image, launched from a protected verified handle with bound argv/cwd/runtime inputs and no mutable loaded dependencies; path/file hash alone is insufficient |
| Workers | Worker reviewed activation refused | A fixed worker implementation with protected launch/image binding and a reviewed invocation/environment boundary. General installed CLIs/providers remain unresolved |
| Verification | Required verification reviewed activation refused | A finite built-in verifier or immutable verified image with the genuine runner, executable, exact argv and cwd bound through launch. Repository scripts/interpreters/dependencies need their own proof |
| Source native | Never activates reviewed authority | Compile a development candidate into an image. Hashing source directories or cached modules cannot create an exact binding |
| Legacy custom tools/caller graph operators | Currently unenrolled; reviewed tool dispatch denied | Conservative descriptive runtime enrollment of actual registered handles in dedicated namespaces; high risk, opaque scope, requiresVerification. No native identity borrowed, attestation implied or grant invented |

Do not implement speculative forms in 4d, add external acknowledgement as a
shortcut for local executors, rename these gaps away, or expand into generic
sandbox development. No safe supported form is established here for those
families. Production opt-in proves the restricted slice, not universal grant
closure. Finish the existing invariant rather than narrow its definition as the
default path. Unsupported forms need not become executable to satisfy mediation:
a request under reviewed authority must reach the shared lookup and produce a
durable denial before an effect. An unavailable allow binding is different from
a missing lookup path. Gap closure needs actual behavior evidence for both.

The present inventory separates them:

| Path | Shared lookup already present | Remaining mediation work |
| --- | --- | --- |
| Native/plugin/MCP model tools, queued tasks and batch leaves | `native-settlement.beginNativeInvocation` | Lift the legitimate producer barrier, prove compiled dispatch and durable unbindable/unenrolled denial |
| Shell, attachments/template context, MCP reads, fixed workflows, worker launch and verification | `recordActionResolution` at their production call sites | Prove each attempted reviewed dispatch reaches lookup and durable denial; unsupported start preflight currently refuses before an action lookup, so preserve a durable, clearly identified preflight refusal rather than misrepresent it as an enforced action |
| Graph operator dispatch | `run-graph.ts` resolves an executor handle but calls `execution.execute` without shared authority lookup | Add canonical-aware mediation before graph effects; reviewed-run references must never bypass through this direct executor path. No-contract graph compatibility must still be explicit |
| Debug agent direct execution | `cli/cmd/debug/agent.ts` resolves a handle then executes directly | Explicitly keep noncanonical calls from borrowing reviewed authority; determine and cover the shared no-contract lookup boundary without silently adding a run |
| Legacy/custom descriptor coverage | Registration remains descriptive opt-in or unenrolled | Design conservative automatic descriptive enrollment separately; immutable actual handle binding, dedicated legacy namespaces, strict descriptors, collision controls and catalog lifecycle tests |

Graph/debug compatibility has no canonical run journal; the current absence of a
run is not proof of universal mediation. Its relationship to the invariant must
be resolved explicitly in C2, not omitted or described as already denied. Where
canonical authority exists, a failed denial append must itself refuse dispatch.
A corrupt or missing authority may be unable to accept a journal record; report
that evidence limitation while still performing zero effects.

Vocabulary/properties remain open until all registered production handles have
validated descriptive identities. Conservative enrollment describes unknown
code without authorizing it and preserves existing no-contract/v1 execution.
Replace compiler-shape approximations in `conformance/contract-capability.test.ts`
with reviewed production creation/dispatch/denial controls before considering
grant closure; unchanged v1 compilation cannot by itself refute the opt-in.

## 9. Execution order and review checkpoints

| Slice | Concrete delivery | Stop/review criterion |
| --- | --- | --- |
| C1 (dependency prerequisite) | Record Astra's exact-SHA inherited dependency audit and any carried limitations | Complete before D1; journal/envelope gap closures still need explicit review/integration |
| D0 (this document) | Architecture, exposure, activity, successor and producer controls | Astra accepts design before any barrier-lifting code |
| D1 | Shared enforcing-image/proof read gate; typed governing-contract reads; guardian/session barrier integration; v1 writer unchanged | Bounded Tier 2 exact-SHA review, all barrier states and real compiled root dispatch; no exposure until this succeeds |
| D2 | Explicit generic creation, inspect/revise/start API, digest-pinned concurrency/recovery, approval ask/always routing, metadata and SDK | Route-based compiled acceptance including crash windows; every legacy/fallback row preserved |
| D3 | Complete MCP/ask/TaskTool compiled producer matrix; correct defects those controls expose | Every required row in section 7 passes; independent adversarial review at exact SHA |
| D4 | Separate bounded session-activity UI bugfix; explicit successor flow/control in its own bounded slice | Canonical completion remains unchanged; idle/open-run and successor isolation controls pass |
| C2 | Conservative descriptive legacy enrollment, missing graph/debug mediation and durable denials; separately approved supported forms only where needed | Grant/vocabulary/property closures need production lookup/denial coverage, not executable support for every family; no default gap narrowing |
| C3 | Review existing project-journal candidate; operator fact inspection/approval; migrate production PM fact reads/writes | Facts owned only by project journal; cited digest-bound approval; replay after source-run removal; denied change never publishes |
| C4 | Governed memory producer using approved project facts | Model may propose, named operator decides exact content; promote/supersede/retire only through journal; no raw model/tool SQLite promotion |
| C5 | Final conformance/recovery/operator flows and future release readiness | Maintainer separately authorizes merge/release/installation; compatibility note covers every new record |

C3 first inventories PM facts versus DSR notes/audit history; existing `pm_note`
permission is not automatically project-memory promotion authority. Historical
SQLite facts require explicit provenance/migration handling, never blanket
coverage. C4 must define allowed fact kinds, operator-reviewed payload, provenance,
sensitivity handling, and retention before a producer is enabled. Remaining
unsupported execution forms are not hidden behind those later workstreams.

## 10. Validation and evidence discipline

This documentation-only deliverable uses evidence/path checks and
`git diff --check`; no build/test result is claimed. Before implementation,
verify the existing pinned Bun executable checksum
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`
at `/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`,
confirm 1.4.0, then use a frozen-lockfile install only in this owned checkout.
Do not replace the global runtime or use another agent's dependency/state tree.

For application diffs, run pinned-Bun typecheck and focused producer/regression
checks, then root `bun run test`; lint is retained as a code-quality check.
Integration/pre-merge code requires `bun run release:gates`, including Rust
verification when its code is touched. Do not duplicate eval smoke alongside
that command. Record source SHA, runtime checksum/revision, command, environment,
exit code and raw log digest. Retain successful and failed attempts under this
checkout's `artifacts/validation/conformance-closeout/`; no artifact path should
contain `packages`, which can contaminate broad Bun test discovery. Record
required unavailable platforms/flows explicitly. Exact-SHA CI and reviewer
acceptance are distinct from implementer checks.

D1 is approved after exact-SHA architecture and bounded C1 dependency review.
D2 exposure remains gated on D1 exact-SHA acceptance. Approved decisions: the restricted generic API opt-in and explicit start, the common
image/proof gate and crash semantics, separate session activity, and the fresh
reviewed successor boundary. Section 8 remains unresolved by design. No release
tag, asset, installed executable, main merge or frozen branch is changed.

Reviewer-provided regression logs at source
`32b2f34fc9dc3d78d20b4a9a29606f6e1a726309` are retained with their provenance and
SHA-256 in `artifacts/validation/conformance-closeout/reviewer-evidence.json`.
They report 185 inherited-path regressions, two independent journal controls,
and 38 final-Opus controls passing,
not producer acceptance of 4d or blanket gap/release acceptance. Codex did not
re-run these logs for this documentation-only slice.
