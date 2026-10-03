# Grant stage 4 proposal: enforcement

Proposal only. Implementer: Claude Opus 5.5. Reviewer: Astra. Recorded 2026-10-01 on
`feat/conformance-execution-opus`. Stage 3 was accepted, inactive, at
`60b56dd24723178ed3f40def27fcbbc14c770120`. This document activates nothing and proposes no
gap closure. Paths are relative to `packages/dax/src`. Builds on the
[stage 3 proposal](GRANT_STAGE3_PROPOSAL.md) and the
[grant compatibility design](GRANT_COMPATIBILITY_DESIGN.md).

## What stage 4 must establish

A run whose reviewed contract was published can execute, and every enrolled action in it
happens only if a grant in that contract covers it, for the implementation that was
reviewed, inside the reviewed scope. Everything else is unchanged.

Stage 4 does not expose the opt-in. Runs are still created only by
`createGrantReviewedRun`. Exposing it through a route or the CLI is a separate decision
after stage 4 is accepted.

## Review amendments, binding

Astra reviewed this proposal at `5fba00a10f4dcb51a2e490526716f75e3b7708a1`, approved its
direction and authorized 4a with five amendments. Decisions 4 and 7 were accepted as
proposed; decisions 1 to 3, 5 and 6 are amended. 4a was accepted, inactive, at
`57d16e559a8f76ca83921172f27baecffe58d86f`, with the restricted boundary below accepted for
4b. The sections below describe that accepted boundary.

| # | Amendment | How it is applied |
|---|---|---|
| 1 | Size and modification time may save work but never authorize; a binding describes what is actually loaded or launched, protected against substitution between check and execution | Every check compares content; nothing is cached by `stat`. The only exact binding is a compiled DAX binary's running image: the embedded bundle read from the process's own memory, plus the runtime revision compiled into it |
| 2 | Hashing source directories, package directories or interpreter scripts misses imported code. Support a bounded set of forms and deny the rest | The supported set is the compiled DAX running image and, as an external exception, a remote MCP server. Source runs, plugin and loader modules, local MCP servers, worker CLIs and verification commands are **unbindable** and never granted |
| 3 | A remote MCP server is a reviewed external source, not an attested implementation | Remote MCP is the only **external** binding. A grant may cover it only with `acknowledgesExternalTrust`, set solely from the operator's acknowledgement in the proposal inputs. It never counts as exact |
| 4 | Durable publication and activation proof in the journal, validated on replay without current files or storage | Required before 4b; specified below under "Journal authority". Not part of 4a |
| 5 | Bind the runner that actually dispatches, the executable, the argument vector and the working directory | The workflow class proposes a runner. At dispatch, the genuine dispatch function, registered once per runner, establishes it; a runner name that does not match the function holding the binding establishes nothing |

### Journal authority (for 4b)

Publication will append a run event carrying the publication proof: revision, approval
ID, approving actor, proposal digest, contract digest and every binding digest with its
attestation. Activation at run start will append a second event carrying the bindings
verified at start. Each `enforced` resolution names the activation event it relies on.
Replay validates the chain from the journal alone: a request, an approved resolution
with an actor, a publication whose digests match the request's subject, an activation
whose bindings match the publication, and resolutions that cite that activation. An
interrupted sequence, such as a resolution without its authorization or an activation
without its publication, stays incomplete and denies.

## 1. Implementation binding

Any binding DAX cannot establish is **unavailable**: the grant does not match and the
action is denied. Nothing falls back to a weaker binding.

| Implementation | Binding |
|---|---|
| Native tool, session capability, fixed workflow | **Exact**, for a compiled binary only: the embedded bundle digest read from the running image and the runtime revision compiled into it, with the build commit for display. A source run of DAX binds nothing |
| Remote MCP server | **External**: URL, header names and tool definition. Granted only with the operator's acknowledgement |
| Plugin and loader modules, package plugins | Unavailable |
| Local MCP server | Unavailable. Its executable is described by content as its launch resolves it, so a reviewer sees what would start |
| Worker profile | Unavailable. Its executable is described the same way |
| Verification command | Unavailable. Described by runner, argument vector, directory and executable |

When it is checked, always by content:

- **At publication**, against a capture publication takes itself.
- **At run start**: every binding is checked once. Any changed or unavailable binding
  refuses the start and the run needs a new revision.
- **At each dispatch**, for the grant the action matched.

A changed binding at dispatch denies that action as `binding_changed` and the run continues
under its other grants. It does not invalidate the run.

## 2. Verification grant selection

The runner is fixed by the path, not chosen at check time:

| Path | Runner |
|---|---|
| `workflows/draft-approve-execute.ts`, `sdlc/verify-session.ts` | `direct` (`sdlc/check-runner.ts`) |
| `worker/worker-verification.ts` (worker runs) | `sandboxed` (`worker/worker-sandbox.ts`) |

So the proposal can name the runner from the workflow class: `sandboxed` for `worker_run`,
`direct` otherwise. The planned commands come from
`runtimePolicy.postconditions.validationCommands` and the detected repository commands. They
are part of the verification grant's binding facts, as argument vectors.

Verification commands have no supported binding form yet, so no verification grant is
proposed. The selection machinery is in place for when one exists: the genuine dispatch
function establishes the runner, and a check matches the plan only with the same runner,
directory, argument vector and executable content. A reviewed run that requires
verification, or launches a worker, is refused at activation, before any effect, rather
than allowed to start work it cannot complete.

## 3. Enforcement across enrolled paths

Enforcement applies only when the governing contract is a published reviewed contract.
Every other run takes exactly its current path.

**Grant is necessary, not sufficient.** For a reviewed run, an action proceeds only if:

1. the shared lookup returns `allow`, or `ask` and the operator approves it;
2. the executor's implementation binding is unchanged;
3. the existing permission rules and runtime guard allow it.

A grant never widens a permission rule or bypasses the runtime guard.

| Path | Today (record only) | Stage 4 for a reviewed run |
|---|---|---|
| Native and plugin tools, queued task, batch leaves | Resolution recorded beside the invocation; fails closed on append failure | Resolution decides before authorization. `deny` settles the invocation as denied with the resolution's reason code. `ask` goes through the existing approval card, which shows the grant |
| MCP tools | As above | As above |
| Operator shell, command-template shell | Recorded; append failure logged and ignored | Decided before the process is wrapped. Append failure denies |
| Attachments, template references | Recorded; isolated | Decided before the read. Append failure denies |
| MCP resource reads, MCP prompt fetches | Recorded; isolated | Decided before the request. Append failure denies |
| Fixed workflow phases, workers | Recorded; isolated | Decided before the phase or launch. Append failure denies |
| Verification checks | Recorded; isolated | Decided before the process, including the reviewed-command check |

The record changes to say what happened: `capability_resolution_recorded` gains the
enforcement value `enforced` for reviewed runs. `record_only` remains for everything else.
The reducer accepts `enforced` only when the run's contract is a published reviewed
contract, and requires the matching authorization or denial to follow it.

**Remembered "always".** An operator's "always" on an `ask` grant is stored under the
contract digest, the grant subject, the executor's capability ID and implementation
binding, and the scope. It never changes the contract and matches nothing else.

**Delegation.** The `task` tool needs a delegation grant naming the agent. A child session
resolves against its parent's reviewed contract and can never hold a grant the parent
lacks. A child of a reviewed run cannot birth its own v1 contract.

**Lifting the barrier.** The stage 3 barrier lifts for one run only when all of these hold:
its review publication is complete, every binding verifies at run start, and the binary
supports enforcement. Only then does the guardian return the published contract as the
run's authority. In every other state the barrier stays as in stage 3.

## 4. Legacy and no-contract behavior

| Situation | Stage 4 behavior |
|---|---|
| Stored v1 contract, any run | Unchanged. Read as written; replay yields its original decisions |
| New run without review | V1, as today |
| Interactive session | V1, as today. No review prompt |
| Session or operator action with no contract | Ungoverned, as today; recorded as `no_contract` where a journal exists |
| Reviewed run, legacy custom tool or caller-supplied operator | No identity, so no grant: denied as `capability_unenrolled` |
| Reviewed run, graph operators (`dax workflow`, `dax explore`) | Not available: they run outside a governed run and are refused there |
| Reviewed run, noncanonical dispatch (debug agent, plugin batch outside a run) | Refused: a reviewed run's authority is only reachable through governed dispatch |
| Reviewed run whose binary lacks enforcement | Stays non-executable, as in stage 3 |
| V1 run continued under review | Needs a new reviewed run; a v1 contract is never upgraded |
| Published v1.5.0 | Cannot read journals containing stage 3 or 4 records, as already documented |

## 5. Delivery slices

Each slice is separately reviewable, with production negative controls, pinned-Bun gates
and exact-SHA CI. None of them exposes the opt-in.

| Slice | Content | Activation |
|---|---|---|
| 4a | Implementation bindings and their checks at publication, run start and dispatch. Verification selection | None; the barrier holds |
| 4b | Enforcement on tool paths: native, plugin, queued task, batch, MCP. `enforced` records | None; exercised only with the barrier lifted inside tests |
| 4c | Enforcement on action paths. Remembered "always". Delegation | As 4b |
| 4d | Lifting the barrier for published runs that pass the start check | Reviewed runs created by the factory become executable |

## Decisions

Decisions 4 (a dispatch-time binding failure denies that action only) and 7 (slicing
4a to 4d, activation only in 4d) were accepted as proposed. Decisions 1 to 3, 5 and 6 were
amended as recorded under "Review amendments" and section 1: exact binding only for a
compiled running image, remote MCP as the only acknowledged external exception, no
binding for modules or launched programs, and the `enforced` value tied to journal
activation proof. The restricted boundary was accepted for 4b at `57d16e5`.

## Acceptance evidence planned

- Each bindable family: an in-place change after review is caught at run start and at
  dispatch, a harmless catalog change is not, and an unavailable binding denies.
- Every unsupported family is refused, acknowledged or not.
- Every enrolled path, for a reviewed run: an action without a grant has no effect; an
  allowed action still obeys a permission deny and the runtime guard; an `ask` grant asks
  and a denial has no effect; append failure denies.
- A blocked tool stays denied under every grant.
- A remembered "always" applies only to the same contract digest, grant, executor, binding
  and scope.
- Every row of the legacy table, shown by the existing stage 1 to 3 regressions unchanged
  plus new rows for graph operators and noncanonical dispatch.
- The barrier holds for every reviewed run state except a completed publication that
  passes the start check.

## 4a as delivered

The first 4a commit, `9ffd1b1`, was refused on review: hidden module dependencies,
a module cached before discovery, executables classified by name, an MCP executable
resolved from the wrong PATH, and a compiled binary hashed from disk after it had been
replaced. The correction narrows what can be bound instead of analysing more:

| Implementation | Binding |
|---|---|
| Compiled DAX binary | **Exact**: the bundle embedded in the running image, read from the process's own memory, plus the runtime revision compiled into it. Replacing the file on disk changes nothing it describes |
| Source run of DAX | None. Development builds are never bound, acknowledged or not |
| Remote MCP server | **External**, the only exception: URL, header names and tool definitions, granted only with `acknowledgesExternalTrust`, set solely from the operator's acknowledgement |
| Plugin and loader modules | None: their dependency closure cannot be established without analysing JavaScript |
| Local MCP server, worker CLI, verification command | None yet: what a launched program runs depends on what it loads, and nothing protects it between check and launch |

Launched executables are still **described** by content so a reviewer sees exactly what
would start. A local MCP server's executable is resolved once, with the launch's own
PATH and working directory, and the transport starts that resolved path; the review
shows the description recorded at launch. A description is never a binding.

Verification selection is in place for when a supported form exists: the plan records
the runner, argument vectors, directory and executable descriptions; the genuine
dispatch function establishes the runner; and a check matches the plan only with the
same runner, directory, argument vector and executable content. No verification grant
is proposed today.

Operators may select MCP source selectors from `onDemandSources`; a selection is granted
only for a remote server and only when its subject key is also acknowledged.

| Part | Where |
|---|---|
| Attestation, running-image identity, executable descriptions | `capability/implementation-binding.ts` |
| Build commit define | `script/build.ts` (`DAX_BUILD_COMMIT`) |
| Shared local MCP launch resolution and launch record | `mcp/index.ts` (`launchFacts`) |
| Proposal: `unbindable`, `needsTrust`, `acknowledgedExternal`, `sourceSelections` | `capability/grant-proposal.ts`, `capability/grant.ts`, `execution/run-factory.ts` |
| Capture | `capability/grant-review-snapshot.ts`, `worker/worker-adapter.ts` |
| Verification dispatch | `sdlc/verification-identity.ts`, `sdlc/check-runner.ts`, `worker/worker-sandbox.ts` |
| Evidence | `conformance/grant-stage4a.test.ts`; stage 3 tests updated |

Nothing is enforced. The stage 3 barrier holds every reviewed run.

| Issue | Location | Severity |
|---|---|---|
| Under enforcement, a reviewed run could use only compiled-DAX native capabilities and acknowledged remote MCP. Plugins, local MCP servers, workers and verification need a supported form first: this is a product decision before 4b | `capability/grant-proposal.ts` | High |
| Tests and source runs cannot exercise a native grant at all; enforcement tests in 4b will need a compiled probe | `capability/implementation-binding.ts` | Medium |
| The native runtime is identified by its compiled-in revision, not by hashing its machine code | `capability/implementation-binding.ts` | Low |

## 4b as delivered

Within the boundary accepted at `57d16e5`: compiled-DAX native capabilities and
acknowledged remote MCP. The barrier stays until 4d.

**Journal proof.** Two run events carry the chain, and the reducer checks each against
this log alone:

| Event | Accepted only when |
|---|---|
| `grant_review_published` | It cites a `capability_grant_review` request in this log; that request was approved by a named actor, the same one the proof names; the revision, proposal digest, contract and run match the request's subject; the contract digest and every binding, in order, are exactly those the request's subject committed to; and the run has not published before. A request whose subject carries no contract and binding commitment can never publish |
| `grant_review_activated` | The run published; the revision and contract digest match the publication; every binding matches the published one in order; the run has not activated before and is not terminal |
| `capability_resolution_recorded`, `enforced` | The run activated and the resolution cites exactly that activation. An allow or ask names its matched grant, which must be an activated binding able to cover the capability: the same identity, or, for an MCP tool matched by its source, an identity that replay re-mints from the recorded server and tool name, by the minting rule itself, on the grant's own server. A resource or prompt source cannot be proven this way without recording a possibly private item name, so no enforced resolution may cite one until a server-provable identity exists (4c). A denial names none. An activated run records no record-only resolution on a tool path |
| `authorization_recorded`, activated run | The invocation has an enforced resolution; the contract disposition agrees with it; an enforced denial is never followed by an allowed authorization |

Publication writes its intent, then the artifact, then the journal proof, then its
completion. An interruption before the proof publishes nothing and is recovered by a new
revision. An interruption after it is rolled forward: the proof settles the publication,
and the artifact is rewritten from the stored revision if it reproduces the proven
digests. A stored artifact that differs from the proof is never read as the published
contract.

**Activation.** `GrantReview.activate` refuses, before any effect, a run that is not
published, a run that needs a worker or required verification (no grant can cover
either), a run already activated, a stored revision whose bindings disagree with the
journal's, and any journal binding that is changed or unavailable in a fresh capture. It
verifies and records the journal's published bindings, never the private record's. It
lifts nothing.

The first 4b commit, `75f46da`, was refused on review: the publication proof was not
linked to what the approval committed to, activation verified the private record rather
than the journal, an enforced allow could name a grant that was never activated, and an
authorization could contradict an enforced denial. The approval subject now carries the
contract digest and bindings, and the reducer enforces the rows above. The second, `583163c`, checked only
the MCP family prefix, so a source grant for one server covered an identity minted for
another; source coverage is now re-minted on replay as above.

**Tool paths.** `beginNativeInvocation` covers native and plugin tools, the queued task
path, batch leaves and MCP tools. For an activated reviewed run it resolves against the
published contract and records an `enforced` resolution citing the activation. The
action is denied before anything runs when the lookup denies, when the binding of the
grant that matched is changed or unavailable now, or when the grant is `ask` (the ask
flow is 4c). An allowed invocation still goes through every permission check and the
runtime guard, which until 4d meet the barrier. A reviewed run that is not activated
meets the barrier at dispatch, as before.

| Part | Where |
|---|---|
| Proof events and reducer checks | `state/events/run-event-types.ts`, `state/events/run-reducer.ts`, `state/events/event-transitions.ts`, `state/events/run-event-store.ts` |
| Publication proof, roll-forward, activation, dispatch authority | `capability/grant-review.ts` |
| Enforcement decision | `capability/enforcement.ts`; grant selection shared from `capability/authority.ts` |
| Dispatch snapshot, without discovery or launch | `capability/grant-review-snapshot.ts` |
| Tool-path enforcement | `execution/native-settlement.ts` |
| Evidence | `conformance/grant-stage4b.test.ts`, including a compiled probe for native acceptance |

| Issue | Location | Severity |
|---|---|---|
| Plugins, local MCP, workers, verification and source-run native capabilities remain unavailable, so enforcement on those families is not established; the related gaps stay open | `capability/grant-proposal.ts` | High |
| `ask` grants are refused until 4c carries the grant through the approval flow | `capability/enforcement.ts` | Medium |
| Native acceptance runs only in a compiled probe of the decision; the full dispatch path is exercised from source, where no native grant can bind | `conformance/grant-stage4b.test.ts` | Medium |
| A governed permission ask for a reviewed run meets the barrier, so it fails closed until 4c and 4d | `execution/governed-ask.ts` | Low |

## 4c, first slice: action paths

4b was accepted, inactive, at `a571b730536001af6257ebcd90ca3da94532d87c`.

Every action path records through `recordActionResolution`, and every caller awaits it
before its effect. For an activated reviewed run that call now decides: the published
contract and the journal's activation decide by the same enforcement as tool paths, the
`enforced` resolution is written first, a failed write denies (`resolution_unrecorded`),
and a denial throws `CapabilityActionDeniedError` before anything happens. A reviewed run
that is not activated meets the barrier there instead of proceeding unrecorded. Every
other run keeps the isolated record-only path, unchanged: a write failure is logged and
the action proceeds. The operator's shell is decided the same way, then permission
denials apply on top. The reducer accepts no record-only resolution on any path of an
activated run.

| Path | In an activated reviewed run |
|---|---|
| Template references, attachments | Decided against filesystem grants and their roots |
| Command-template shell, operator shell | Decided, under the contract's tool lists |
| Fixed workflow phases | Decided per phase |
| MCP resource reads, prompt fetches | Denied as `source_unproven`: the source cannot be proven without recording the item name |
| Workers, verification checks | Unreachable: activation refuses runs that need them |

Within the accepted boundary every session and workflow capability binds only to a
compiled running image, so from source every action is denied; a compiled probe shows the
allow side, including filesystem scope inside and outside the reviewed roots.

### Server-provable MCP read identities: compatibility design

The direction was accepted at `3a3f683` with binding conditions. This records the design
before any implementation; nothing below is built yet.

**Format.** A new version per family, minted only by new code:
`mcp.<family>.v2.s<hex(sha256("dax.mcp.<family>.server.v2\0" ‖ len:server))>.m<hex(sha256("dax.mcp.<family>.v2\0" ‖ len:server ‖ len:item))>`,
with every part length-prefixed in UTF-8 bytes and lone surrogates rejected, as the v1
minting does. The two digests are domain-separated from each other and from v1.

| Condition | How it is met |
|---|---|
| Historical v1 records unchanged and never v2 evidence | v1 minting stays as it is and keeps minting v1 for every existing caller of the v1 function. Replay treats a v1 resource or prompt identity as carrying no server commitment, so an enforced resolution citing a source grant for it stays refused |
| The complete identity, family and server validated, not a prefix | Replay parses the whole identity against one exact pattern for its family and version, recomputes the server digest from the grant's server and requires it to match exactly, and validates the item digest's format. It cannot recompute the item digest, which would need the private item name |
| Domain-separated, unambiguous hashing | Distinct prefixes for the server segment and the item digest, length-prefixed parts, the same validation rules as v1 |
| Item names never in journals | Only the identity is recorded. The server segment commits to the server name, which the grant already names. Hashing is not encryption: a short or guessable item name can be found by trying candidates against the item digest, and nothing here authenticates the server's identity |
| Old exact grants never authorize v2 identities | An exact grant names one identity string; a v1 string never equals a v2 one, and nothing maps between them |
| Unsupported v1 source coverage stays denied | As today |

Rollout, when reviewed: mint v2 for new reads in reviewed runs only, keep v1 everywhere
else, and add the v2 identities to the on-demand families of the vocabulary.

### 4c second slice: ask grants and the remembered "always"

The 4c corrections were accepted at `144ed919f87641a7b6e9d238cdbbae67eab9a620`, with the
MCP identity design approved under the wording correction above.

An operator may mark grants `ask` in the proposal (`askSubjects`). In an activated run an
`ask` is never allowed by the record itself:

| Step | Behaviour |
|---|---|
| The request | An `approval_requested` of type `capability_grant_ask`, correlated to the action, with a subject naming exactly the grant, the capability, the contract digest and the binding digest. The reducer accepts it only when those match the run's activation |
| The answer | The operator approves or denies through the existing approval transitions. Only an approval with a named actor counts, at runtime and on replay. No answer within `DAX_GRANT_ASK_TIMEOUT_MS` (default 10 minutes) expires the request and denies |
| "Always" | `grant_ask_remembered`, appended only after a named approval of that very ask and only for its exact subject. A later ask for the same grant, capability, contract and binding is satisfied by it; a different capability under the same grant is asked again |
| Tool paths | The `ask` resolution is recorded, then the operator is asked; the reducer allows the invocation's authorization only with that approved ask in the log, or a cited memory |
| Action paths | The ask is settled before the action and its resolution records what settled it; an action's ask without that is refused |

Scope is not part of the subject separately: one contract holds one grant per subject,
and the contract digest commits to its scope.

Review at `06c5a95` found three boundaries open, now closed:

| Finding | Correction |
|---|---|
| Replay accepted an `allow` resolution under an `ask` grant | Every binding in the approval subject, the publication and the activation carries its grant's decision. An enforced allow or ask must carry exactly its activated grant's decision |
| An approval given while the binding changed still let the action run | After the wait, the decision is made again from the authority and implementation as they are then; any change denies, on tool and action paths |
| A failed expiry with a racing approval left a timed-out invocation authorizable | Each grant ask carries its deadline, and replay refuses an approval recorded after it. A denial is always recordable, recorded before the ask is closed, and the invocation is never left pending in the process |

### Remaining 4c

Delegation grants for the `task` tool and child sessions.

### 4c first slice: corrections

Review at `3a3f683` found two boundaries open. An unreadable session, review store or
missing instance was treated as an unreviewed run, so a template stat could still run;
compatibility now applies only after the governing run is read and the review store
answers that it has no review, and anything uncertain denies as `authority_unreadable`
before any effect. The reviewed operator shell read session permissions before awaiting
the agent lookup; it now looks up the agent first and decides on a session read with
nothing awaited after it.

## Not in stage 4

Exposing the opt-in through a route, configuration or the CLI; interactive-session review;
remote MCP attestation; install-manifest binding; gap closure.
