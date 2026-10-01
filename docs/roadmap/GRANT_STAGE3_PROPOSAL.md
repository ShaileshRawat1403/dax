# Grant stage 2 summary and stage 3 proposal

Proposal only. Implementer: Claude Opus 5.5. Reviewer: Astra. Recorded 2026-10-01 on
`feat/conformance-execution-opus` at `fd5bef68edb61c5a15fe3eff0da50934c792faea`.
It activates nothing, changes no schema and proposes no gap closure. V2 stays inactive
until this proposal passes architecture review. Paths are relative to `packages/dax/src`.
The compatibility rules it builds on are in the
[grant compatibility design](GRANT_COMPATIBILITY_DESIGN.md).

## Stage 2 summary

### What was accepted

| Delivery | Accepted SHA | What it holds |
|---|---|---|
| Stage 1 | `d2470c90dd518450c25006b531419e7eac4c56d9` | V1 tool decisions bound to the selected executor; operator shell bound by the governing contract and permission denials, decided on a snapshot read after resolution |
| Stage 2, first | `4a08f28dc7dbd594a2c1fd23d067c569aec2bb08` | Shared lookup, inactive grant format, record-only event, tool paths and operator shell, validated under the run lock before persistence |
| Stage 2, second | `fd5bef68edb61c5a15fe3eff0da50934c792faea` | The eight remaining DAX-dispatched paths |

### What exists now

- **One lookup.** `resolveCapabilityAuthority` (`capability/authority.ts`) is pure. Its
  inputs are the governing contract, the selected executor's descriptor and provable
  target evidence. It never takes an alias as identity. Under v2 a missing grant denies,
  asking needs an explicit `ask` grant, an unenrolled executor is denied, and an MCP
  source selector matches only a source that re-mints the exact identity.
- **One record.** `capability_resolution_recorded` is written beside every governed
  action in a canonical run. Its `enforcement` is the literal `record_only`; the reducer
  keeps it apart and reads none of it for authority; it is validated under the run lock
  before it is persisted.
- **Coverage.** Native and plugin tools, the queued task path, MCP tools, batch leaves,
  operator shell, command-template shell, attachments, template references, MCP
  resources and prompts, fixed workflows, workers and verification checks.
- **Not covered, by design:** graph operators from `dax workflow` and `dax explore`,
  any session or run with no canonical journal, a run with no stored contract, and
  dispatch outside a canonical run.
- **Inactive.** `ExecutionContractV2` and the grant schema exist. The guardian refuses to
  write or read a v2 contract. Nothing enforces a grant.

### What it does not establish

Recording proves the lookup is reached on every covered path with the right identity. It
does not prove the lookup's conclusion is the right authority, because no operator has
reviewed any grant. Both `inv5.contract-grants` and `inv5.grant-resolution` stay open, and
`main` still has eight accepted open gaps.

### Open findings carried into stage 3

| Issue | Location | Severity |
|---|---|---|
| Template references in a `/command` on a session's first prompt are not recorded: the run is born inside `prompt()`, after the command resolves its template | `session/prompt.ts` `command` | Low |
| No dedicated injected-append test for an action path; the reviewer's independent injection covered it | `capability/record-resolution.ts` | Info |
| Windows intermittents: process-tree kill timeout in `sdlc/check-runner.test.ts:52`; `afterAll` cleanup timeout in `state/recovery.test.ts` | CI | Medium |
| A dependency install is approved by directory, not by manifest content | `project/trust.ts` | Medium |
| Noncanonical plugin dispatch performs no wrapper permission check | `tool/batch.ts`, `cli/cmd/debug/agent.ts` | Medium |

## Stage 3 proposal: operator-reviewed grants

### The problem stage 3 solves

A contract today is a tool filter compiled from prompt text by keyword rules. Nobody
reviews it. "Operator-reviewed contract" therefore names something that does not yet
exist. Stage 3 builds the review, so that a v2 contract can only come into being as the
exact grant set an operator approved. It does not turn enforcement on; that is stage 4.

### Bounds

- New runs only, and only when the run request opts in. Nothing about an existing run,
  a stored contract or an interactive session changes.
- No configuration switch and no default. The opt-in is a field on the run request, and
  in stage 3 it is not exposed on any route: reachable from tests only, until stage 4's
  architecture review wires it.
- The shared lookup keeps recording, record only. Stage 3 adds no enforcement.

### Review amendments, binding

Astra reviewed this proposal at `52898e52221592e0c159c1086e609e01f01b4234` and
authorized implementation with five amendments. They replace the earlier text of steps
1 to 3 and are reflected below. Decisions 2 to 5 were accepted; decision 1 is amended.

| Finding on the proposal | Amendment |
|---|---|
| A capability ID names a logical source, not an implementation: a plugin file edited in place keeps its ID | Approval binds the implementation as well as the identity |
| A per-server MCP family grant could match a tool the contract blocks | The proposal grants exact identities; a family grant never revives a blocked tool |
| An approved v2 contract, once stored, needs a barrier until stage 4 | Reviewed storage is separate from executable contract access, and every entry point refuses the run |
| Missing filesystem evidence defaulted to run scope | The grant is omitted unless the operator explicitly accepts unconfined run scope |
| Approval publication needed defined recovery | Publication is serialized, validated against the current request, and fails closed when uncertain |

### Step 1: a proposal, which is data

`proposeGrants` derives a candidate from inputs known at run creation:

| Input | What it contributes |
|---|---|
| The compiled v1 contract's allowlist and blocklist | Which aliases the run may use at all |
| A capability catalog snapshot | The identity each allowed alias would select, so a grant names `native.tool.read`, not `read` |
| The workflow class, provider hint and verification plan | `workflow.<class>.<phase>`, `worker.profile.<id>` and `verification.command.<runner>` grants |
| `runtimePolicy.writeScope`, only when its provenance is reviewed | Filesystem roots for filesystem-capable grants |

Rules:

- An alias the contract blocks yields no grant, and stays blocked under v2 whatever other
  grant exists.
- MCP tools the contract allows are granted by their exact identity. The proposal never
  adds a server or family selector; an operator may add one in review, where its breadth
  is shown, and it still cannot revive a blocked tool.
- A filesystem-capable capability without reviewed scope evidence is not granted. It is
  listed as needing a scope. Only an operator edit can grant it run scope, and only with
  an explicit statement that run scope provides no filesystem confinement.
- A legacy executor has no identity and is listed as excluded.
- A delegation capability is listed as needing scope: a v1 contract names no agents.
- MCP resource reads and prompt fetches have no enumerable identity. Each configured
  server is listed for the reviewer, who may add a source selector; none is proposed.

### Step 2: binding the implementation, not only the identity

Every granted subject is recorded with an implementation binding: a digest over the facts
that make that capability what it is now. Only granted subjects are bound, so adding or
listing unrelated tools changes nothing.

| Family | Bound facts |
|---|---|
| Native tool, session capability, fixed workflow, verification runner | DAX version and capability ID; for verification, the runner and the planned commands |
| Loader or opt-in custom tool | Its source, its declared metadata and schema, and the content digest of its entry file where local |
| MCP tool | The server's configured transport and command or URL, the names of its environment variables, and the tool's listed definition |
| MCP source selector | The server's configured transport and command or URL, and its environment variable names |
| Worker profile | The profile's reviewed metadata and the resolved binary path |

The proposal, its derivation inputs and these bindings are committed together. Checking a
binding later gives one of three answers: unchanged, changed, or unavailable (for example
a server not connected). Changed or unavailable means the approval no longer covers what
would run, and the run needs a new review. Not covered: the content of a worker's external
binary, imports outside a plugin's entry file, and any attestation of a remote server's
implementation.

### Step 3: review bound to the exact content

The review is stored separately from executable contracts, in revisions. Each revision
has one approval request whose subject commits to the candidate, the derivation inputs and
the bindings:

```
contractGrantSubject: {
  kind: "contract_grant_set",
  runId, contractId, revision,
  canonicalization: "sorted-json-v1",
  digest: "sha256:<over candidate, inputs and bindings>"
}
```

Publication, under the run lock:

- Approved, for the current revision's request, with matching run, contract, revision and
  digest, and every grant's binding unchanged in a fresh capture: the approved artifact is
  written. Only then. A changed or unavailable binding requires a new revision.
- A new revision supersedes the previous one; its request is closed as expired in the same
  locked step, and an approval of it publishes nothing.
- Denied, expired or never answered: nothing is published.
- A repeated approval of an already published revision is a no-op, never a second
  publication.
- Publication writes an intent before the artifact and a completion after it. An intent
  without a completion after a restart is uncertain; it is never treated as published, and
  the run needs a new revision.

### Step 4: the barrier until stage 4

A run with a grant review is non-executable in stage 3, whatever the review's state,
including approved and published. The guardian refuses its authority; there is no v1
contract to fall back to, and the run's session cannot be given one. Prompting the
session, running a command or operator shell in it, dispatching a tool, and starting or
resuming its workflow each fail before any provider call or effect.

### Step 5: what the approved contract will mean for execution

Recorded now, enforced in stage 4: executor binding by identity and implementation, no
retargeting; scope binding; missing grant denies; `ask` only by an explicit grant; a
remembered "always" bound to contract digest, grant, executor identity and scope; a child
never holds a grant its parent lacks.

### Legacy behavior, explicit

| Situation | Behavior |
|---|---|
| Stored v1 contract, any run | Read exactly as written. Replay yields its original decisions. No grant is invented for it |
| New run without the opt-in | V1, as today, with the stage 1 executor rule |
| Interactive session | V1, as today. Stage 3 adds no review prompt to session birth |
| Operator-direct action with no contract | Ungoverned, as today, and recorded as `no_contract` where a journal exists |
| Legacy custom tool or caller-supplied operator under v2 | No identity, so no grant can name it: denied as `capability_unenrolled` |
| V1 run resumed for consequential work in a v2 context | Requires a new opted-in run with its own reviewed contract. The v1 contract is never mutated or upgraded |
| Published v1.5.0 | Cannot read development journals that contain these records, as already documented |

### Decisions

All five were reviewed. Decisions 2 to 5 were accepted as proposed, including grants for
operator-initiated paths in opted-in v2 runs. Decision 1 was amended as described above.

### Acceptance evidence for stage 3

- The same inputs produce the same proposal and digest; a changed catalog produces a
  different one.
- A blocked alias yields no grant; a non-native executor under a native alias yields its
  own identity, marked; a legacy executor yields none and is listed.
- Approval with the matching digest writes exactly the candidate v2 contract; a different
  digest, a stale request, a denial or no answer writes nothing and starts nothing.
- After approval the contract cannot be changed, and replay reproduces it.
- A stored v1 contract, an interactive session and a run without the opt-in behave
  exactly as before, shown by the existing stage 1 and stage 2 regressions unchanged.
- The guardian refuses every run with a grant review, approved or not, and the prompt,
  command, operator shell, tool dispatch and workflow entry points produce no provider
  call and no effect for it.
- A blocked tool and an allowed tool on the same MCP server: the blocked one stays denied
  under any grant.
- Publication under concurrent revisions, duplicate approval, denial, expiry and an
  interrupted publication.
- Nothing is reachable from a route or configuration.

### Stage 3 as delivered

| Part | Where |
|---|---|
| Proposal, bindings, binding check | `capability/grant-proposal.ts` |
| Capture of this instance's catalog, without secret values | `capability/grant-review-snapshot.ts` |
| Review store, revisions, publication | `capability/grant-review.ts` |
| Barrier | `execution/grant-review-barrier.ts`, checked first by every contract read and at the top of `prompt`, `loop`, `command` and `shell` |
| Approval subject | `state/events/contract-grant-approval.ts`, carried by `approval_requested` |
| Unexposed creation | `createGrantReviewedRun` in `execution/run-factory.ts` |
| Resolver amendments | `capability/authority.ts`: under v2 the contract's tool lists still bind, and run scope covers a filesystem-capable capability only with `acknowledgesNoFilesystemConfinement` |
| Evidence | `conformance/grant-stage3.test.ts`, additions to `capability/authority.test.ts` |

Choices and limits to review:

| Issue | Location | Severity |
|---|---|---|
| The run state machine reaches `waiting_approval` only through `running`, so a reviewed run passes through `running` with a start time, and approval returns it to `running`, although nothing can execute. Changing the state machine is an authority change and was not made | `execution/run-factory.ts` `createGrantReviewedRun` | Medium |
| The opt-in is a factory function, not a field on the run request, so the request schema is unchanged and nothing can reach it from a route | `execution/run-factory.ts` | Info |
| Verification runners are not captured at review: the runner is chosen when a check runs, so no verification grant is proposed | `capability/grant-review-snapshot.ts` | Low |
| A plugin from a package, not a local file, binds its source and metadata but not content | `capability/grant-review-snapshot.ts` | Low |
| The session entry checks are, today, redundant with the guardian barrier, which the AGY binding check reaches first; the negative controls show the guardian barrier is the load-bearing one | `session/prompt.ts` | Info |
| The run inspector reports a reviewed run as `execution_contract_unreadable` rather than naming the review | `server/run-gateway.ts` | Low |

Bindings are checked at publication against a fresh capture of this instance. Harmless
catalog changes, such as a new unrelated tool, leave them unchanged.

### Not in stage 3

Enforcement of grant decisions, exposing the opt-in, interactive-session review,
graph-operator coverage, install-manifest binding, and noncanonical plugin permission
checks.
