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

## Not in stage 4

Exposing the opt-in through a route, configuration or the CLI; interactive-session review;
remote MCP attestation; install-manifest binding; gap closure.
