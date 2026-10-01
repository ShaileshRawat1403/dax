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

### Step 1: a proposal, which is data

`proposeGrants` derives a candidate grant set from inputs that are all known at run
creation and all recorded:

| Input | What it contributes |
|---|---|
| The compiled v1 contract's allowlist and blocklist | Which aliases the run may use at all |
| A capability catalog snapshot taken at proposal time | The identity each allowed alias would select, so a grant names `native.tool.read`, not `read` |
| The workflow class, provider hint and verification plan | `workflow.<class>.<phase>`, `worker.profile.<id>` and `verification.command.<runner>` grants |
| `runtimePolicy.writeScope`, only when its provenance is reviewed | Filesystem roots for `edit`, `write` and `apply_patch` grants; otherwise run scope |

Rules the derivation keeps:

- An alias the contract blocks yields no grant. An alias held only by a non-native
  executor yields a grant for that executor's identity and is marked for the reviewer.
- A legacy executor has no identity and yields no grant; it is listed as excluded so the
  reviewer sees what the run cannot do.
- An MCP family yields a source selector for each configured server, never a grant by
  display alias.
- Delegation grants name agents only when the contract names them. There is no
  wildcard.
- The proposal is deterministic for its inputs, and its inputs are recorded with it, so a
  reviewer can reproduce it.

A proposal authorizes nothing. It cannot be read by the guardian.

### Step 2: review bound to the exact content

The run is created in `waiting_approval` with one approval request whose subject commits
to the complete candidate v2 contract, grants included:

```
contractGrantSubject: {
  kind: "contract_grant_set",
  runId, contractId,
  canonicalization: "sorted-json-v1",
  digest: "sha256:<over the full candidate ExecutionContractV2>"
}
```

This follows the existing digest-bound pattern for project facts
(`state/events/project-fact-approval.ts`): the run log carries the commitment, not a copy.

- **Approved** with a subject whose digest equals the candidate: the guardian writes that
  exact v2 contract, and only then. It is immutable from that point.
- **Approved** with any other digest, or a stale request: refused; nothing is written.
- **Denied**, expired or never answered: no v2 contract exists and the run does not
  start. There is no fallback to v1 for an opted-in run.
- **Edited before approval**: an edit is a new candidate with a new digest and a new
  request. The old request cannot approve it.

The reviewer sees each grant with the executor identity it names, its decision and its
scope, the excluded legacy executors, and every alias that is held by a non-native
executor.

### Step 3: what the approved contract means for execution

Recorded in stage 3, enforced in stage 4:

- **Executor binding.** A grant names a capability identity. If the executor under an
  alias changes after approval, its identity changes, the grant does not match, and the
  action is denied as `grant_absent`. There is no retargeting.
- **Scope binding.** A filesystem grant covers only canonical paths inside its roots; an
  unprovable target is denied as `scope_unproven`. A delegation grant covers only the
  named agents. A source selector covers only its server and family.
- **Missing grant.** Denied. Never a prompt.
- **`ask` grant.** Asked through the existing approval card, which shows the capability
  and the grant. A remembered "always" applies only to the same contract digest, the
  same grant, the same executor identity and the same scope, and is never written back
  into the contract.
- **Children.** A delegated child resolves against its parent's approved contract and
  cannot hold a grant the parent lacks.

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

### Decisions requested

1. **Derivation.** Adopt the input table above as the only source of proposed grants,
   with run scope wherever reviewed scope evidence is absent. Recommended.
2. **Opt-in location.** A field on the run request, unexposed until stage 4. No
   configuration key. Recommended.
3. **Review surface.** The existing approval request with the new digest-bound subject,
   rather than a new approval channel. Recommended.
4. **Operator-initiated paths under v2.** Attachments, template references, MCP resource
   reads, MCP prompt fetches and the operator and command shells are operator actions.
   Options: require grants for them like any other path, or keep them on their existing
   rules and record them. Recommended: require grants, because an operator-reviewed
   contract that does not cover the operator's own reads is a gap, and a denial is
   visible and immediate. This changes behavior for opted-in runs only.
5. **Graph operators.** They have no journal today. Leave them outside v2 until they run
   inside a governed run. Recommended.

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
- The guardian still refuses any v2 contract that did not come through an approved
  review.
- Nothing is reachable from a route or configuration.

### Not in stage 3

Enforcement of grant decisions, exposing the opt-in, interactive-session review,
graph-operator coverage, install-manifest binding, and noncanonical plugin permission
checks.
