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

## 1. Implementation binding

Stage 3 binds native capabilities to the DAX version label and package plugins to their
source and metadata. Neither establishes an exact implementation. Stage 4 replaces both,
and treats any binding it cannot establish as **unavailable**: the grant does not match
and the action is denied. Nothing falls back to a weaker binding.

| Family | Stage 3 binding | Stage 4 binding |
|---|---|---|
| Native tool, session capability, fixed workflow, verification runner | DAX version label | **Executable identity**: for a compiled binary, the SHA-256 of `process.execPath` computed once at startup, plus the build commit injected as a new `DAX_BUILD_COMMIT` define. For a source run, the commit plus a digest of the tracked `packages/dax/src` tree; a dirty or unknown tree is unavailable |
| Local loader or plugin file | Entry file digest | Entry file digest plus the digests of the local modules it imports, walked from the entry file and kept within the trusted roots. An import that leaves them, or cannot be resolved, makes the binding unavailable |
| Package plugin | Source and metadata | The resolved package directory's content digest over its files, taken once per process. An unresolvable package is unavailable |
| Local MCP server | Command, environment names, tool definition | As before, plus the digest of the resolved executable named by `command[0]`. For an interpreter (`node`, `bun`, `python`, `uvx` and similar) the next argument, when it is a local file, is digested as well |
| Remote MCP server | URL, header names, tool definition | Unchanged. The review shows it as **remote, unattested**. Remote implementation attestation stays out of scope |
| Worker profile | Profile metadata and binary path | Plus the SHA-256 of the resolved binary |

When it is checked:

- **At publication**, as in stage 3.
- **At run start**: every binding is checked once. Any changed or unavailable binding
  refuses the start and the run needs a new revision.
- **At each dispatch**, for the executor about to run. The check is cached per process
  by path, size and modification time and recomputed on any difference, so the hot path
  is one `stat` per executor.

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

At dispatch, a check whose argument vector is not one of the reviewed commands is denied as
`verification_command_unreviewed`. A run with no planned commands proposes no verification
grant, and a run that requires verification without one cannot be approved: the proposal
lists it under `needsScope`, as it does filesystem capabilities without roots.

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

## Decisions requested

1. **Executable identity.** Hash the running binary and inject the build commit; treat a
   source run with a dirty or unknown tree as unavailable. Recommended.
2. **Plugin closure.** Bind the local import closure within the trusted roots and package
   directory content; anything unresolvable is unavailable. Recommended.
3. **Local MCP.** Bind the resolved executable and, for known interpreters, the script
   argument. Recommended.
4. **Dispatch-time binding failure** denies that action only, not the whole run.
   Recommended.
5. **Verification.** Runner from the path; reviewed argument vectors; unreviewed commands
   denied. Recommended.
6. **New enforcement value** `enforced` on `capability_resolution_recorded`, readable only by
   this build. Recommended.
7. **Slicing** 4a to 4d as above, with activation only in 4d. Recommended.

## Acceptance evidence planned

- Each binding family: an in-place change after review is caught at run start and at
  dispatch, a harmless catalog change is not, and an unavailable binding denies.
- A dirty source tree, an unresolvable plugin import and an unresolvable package each make
  the binding unavailable.
- Every enrolled path, for a reviewed run: an action without a grant has no effect; an
  allowed action still obeys a permission deny and the runtime guard; an `ask` grant asks
  and a denial has no effect; append failure denies.
- A blocked tool stays denied under every grant, and a verification command outside the
  reviewed list is denied.
- A remembered "always" applies only to the same contract digest, grant, executor, binding
  and scope.
- Every row of the legacy table, shown by the existing stage 1 to 3 regressions unchanged
  plus new rows for graph operators and noncanonical dispatch.
- The barrier holds for every reviewed run state except a completed publication that
  passes the start check.

## Not in stage 4

Exposing the opt-in through a route, configuration or the CLI; interactive-session review;
remote MCP attestation; install-manifest binding; gap closure.
