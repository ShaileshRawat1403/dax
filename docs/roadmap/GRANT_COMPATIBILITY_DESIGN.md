# Contract grants and shared enforcement: compatibility design

Proposal only. Implementer: Claude Opus 5.5. Reviewer: Astra. Recorded 2026-09-30
on `feat/conformance-execution-opus`. It activates nothing, changes no contract
schema and proposes no gap closure. It asks for seven decisions before any
enforcement work starts. Paths are relative to `packages/dax/src`.

## What this has to get right

Two ledger gaps are in scope: `inv5.contract-grants` and `inv5.grant-resolution`.
The risk is not the new path. It is what happens to everything that already exists:
stored contracts, running sessions, entry points that have no contract, and
executors that have no descriptor. Every rule below is judged by one test: it may
narrow what runs, and it may never widen it or relabel an old decision.

## What exists today

| Fact | Location |
|---|---|
| A contract lists tools by alias: `toolAllowlist`, `toolBlocklist`. An empty allowlist means unrestricted. The blocklist wins. No contract means allowed | `execution/execution-contract.ts:150` |
| Every native model execution gets a contract at birth. It is compiled from the prompt text by keyword rules. No operator reviews it | `session/prompt.ts:189`, `execution/compiler.ts:215` |
| Contracts are immutable once the run has event authority | `execution/contract-guardian.ts` |
| A governed child session resolves its parent's contract through `governingRunId`; an unreadable reference throws and is never treated as ungoverned | `execution/contract-guardian.ts` `resolveExecutionAuthority` |
| The contract tool filter runs at native dispatch, batch leaves and MCP tools. Permission is asked by alias class | `session/prompt.ts:1290,1331,1396`, `tool/batch.ts:92`, `execution/native-settlement.ts:154` |
| Workflows, graph operators, workers, command shell, operator shell, attachments, MCP resources and prompts, and verification commands do not consult the contract's tool lists. Each has its own approval or none | see the [entry-point audit](CAPABILITY_ENTRY_POINT_AUDIT.md) |

So "operator-reviewed contract" does not describe the present. A contract today is
a machine-compiled tool filter. That shapes every decision below.

### The preparatory branches

Both are outside the baseline and unmerged. Their slice-to-SHA mapping was verified
against the tree: heads match local and origin refs, and neither is an ancestor of
`3c47d1a3045fa311bba4755d3aff8c5735e1baa2`.

| Commit | What it gives | What it does not |
|---|---|---|
| `af3b216546014341ddfac8df00d62a8ce364126b` | Strict `CapabilityGrant` schema (`allow` or `ask`; scope `run`, `filesystem` roots, `delegation` agents), `ExecutionContractV2`, a pure resolver that denies an absent, unsupported, unproven or out-of-scope grant | No production caller |
| `19f09375fa4d2736d533bcfaae12306b5b5ad42d`, `20ebf4902ebc2c9b3dce7791f9903730af669f18` | v2 kept inert: the guardian refuses a v2 contract on read and write | No activation path |
| `a2cab7370582f96f8a70978994f92ad11de3423a` | Native dispatch and batch leaves intersect the alias filter with a grant decision; optional capability ID on native receipts | A v1 contract is still decided by alias. `ask` fails closed with no operator flow. Only `read`, `write` and `edit` supply a filesystem target. No other executor family |

I propose adopting the schema and resolver from `af3b216` after review, and
reworking `a2cab73` rather than merging it: it does not fix the alias finding for
v1, and it conflicts with files changed since.

## Compatibility classes

### 1. Stored v1 contracts

Never reinterpreted, never upgraded, never given grants. Replay reads them under
v1 semantics. A v1 contract that is still running keeps running under v1 rules.
Today's registry is never loaded as authority for a past decision.

One narrowing is proposed for v1, because it closes a demonstrated bypass without
touching the stored contract. See decision 1.

### 2. Entry points with no contract

A model-selected action always has a contract, because birth creates one. What has
none is operator-direct: the session shell before any prompt, the `dax workflow`
and `dax explore` graph commands, the debug agent command, and prompt-time context
reads in a session that has not been born.

Proposed rule: "no contract" is a named, recorded disposition available only to
operator-direct entry points. It is not a fallback. Any entry point in a session
that has a `governingRunId` resolves that contract and is bound by it. That covers
the required operator-shell behavior: in a governed session it respects contract
and permission denials before spawning, and records authorization and outcome.

### 3. New contracts

A v2 contract carries grants. Two questions decide whether it can be called
operator-reviewed: who writes the grants, and where the operator sees them.

Proposed: the compiler may propose grants, exactly as it proposes a tool list now.
A proposal is not authority. A v2 contract becomes executable only after an
operator review step records approval of that exact grant set, bound to the
contract digest. Until a review surface exists and is accepted, v2 stays inert.
See decisions 2 and 3.

### 4. Executors with no descriptor

Legacy custom tools and caller-supplied graph operators stay compatible under v1
and under no contract. Under v2 there is no grant that could name them, so they are
denied as `capability_unenrolled`. That is the "explicit enrollment for the governed
path" already decided, and it is what would let the vocabulary gap close for v2 runs.

## Resolution rule

One function decides, for every path. Its inputs are the governing contract, the
selected executor's descriptor, and target evidence. Its output is `allow`, `ask`
or `deny` with a reason code.

- Authority is resolved from the selected executor's capability ID, never its
  alias. A loader tool named `read` has a `plugin.tool.v1.*` ID and cannot match a
  grant for `native.tool.read`.
- A grant is necessary and never sufficient. The contract filter, permission
  rules, runtime guard, sandbox and verification all still apply, and any denial wins.
- A child resolves against its parent's contract. A delegation grant can only
  narrow which agents may be dispatched. Nothing a child does widens its parent.
- It is evaluated before hooks and again after every awaited approval.
- An identity failure is final for that attempt: no retarget and no retry.
- A target that cannot be proven is `scope_unproven` and denied. Scope is never
  inferred from text that looks like a path.

### Coverage and target evidence

| Path | Identity | Target evidence available | Scope a grant can express |
|---|---|---|---|
| Native `read`, `write`, `edit` | `native.tool.*` | Validated single `filePath` | Filesystem roots |
| Native `apply_patch` | `native.tool.apply_patch` | Parsed patch targets, if validated before dispatch | Filesystem roots once that is proven; else run |
| Native `glob`, `grep`, `lsp`, `skill` | `native.tool.*` | Search root, not the matched set | Run, until proven |
| Native `shell`, `git_branch`, `batch`, web tools | `native.tool.*` | None | Run |
| Batch leaf | The leaf's own ID | As the leaf | As the leaf; the batch grant grants no leaf |
| Native `task` | `native.tool.task` | Resolved agent | Delegation agents |
| Loader, opt-in custom, MCP tool | `plugin.tool.v1.*`, `mcp.tool.v1.*` | None | Run |
| MCP resource, MCP prompt | On-demand ID per source | Server and name | Run; see decision 5 |
| Fixed workflow, graph operator, worker | `workflow.*`, `operator.*`, `worker.profile.*` | Class and phase; type and action; profile | Run |
| Command shell, operator shell | `session.command.shell`, `session.shell.operator` | None | Run |
| Attachments, template reference | `session.context.*` | Resolved file path | Filesystem roots |
| Verification command | `verification.command.*` | Planned argv | Run |

Receipts record the capability ID, the governing contract, the grant that matched
or the reason none did, and the final decision. A denial is a durable receipt too.
The field is optional in the event schema so earlier events stay valid.

## Staged delivery

| Stage | Change | Activates |
|---|---|---|
| 1 | Alias binding for v1 (decision 1); operator shell bound by the governing contract and permission; both audit probes inverted into negative regressions | Narrowing only, no schema change |
| 2 | Grant schema and resolver adopted; shared resolution called at every path in the table in record-only mode: it computes and records a decision and enforces nothing | Nothing |
| 3 | Operator review surface for a proposed grant set; `ask` routed through the existing approval card with the capability and grant shown | Nothing until reviewed |
| 4 | v2 accepted for new runs by explicit opt-in | v2 for opted-in runs |

Each stage is its own review. Stage 2 exists so the matrix above is proven against
production dispatch before anything depends on it.

## Decisions requested

1. **Alias binding under v1.** Today an allowlisted alias admits whichever executor
   holds it. Proposed: when the selected executor is not native and its alias is a
   native tool ID, the v1 allowlist entry does not cover it, the read-only
   classification does not apply, and permission is asked under the executor's own
   identity. Blocklist behavior is unchanged: a blocked alias stays blocked for any
   executor. This narrows existing behavior for anyone who deliberately overrides a
   native tool with a plugin of the same name in a restricted contract.
   Recommended: adopt.
2. **Who may author grants.** Proposed: the compiler proposes, an operator approves,
   and only the approved set is authority. Alternative: operators write grants by
   hand. Recommended: compiler proposes.
3. **Where the operator reviews.** An interactive session is born on its first
   prompt, so a review step there is a prompt on every new session. Proposed:
   v2 first for run-API and fixed-workflow runs, which already have an approval
   gate, and interactive sessions stay v1 until a review surface is accepted.
   Recommended: adopt; it avoids inventing consent.
4. **Legacy consequential resume.** The approved registry proposal says resuming a
   legacy run for consequential execution needs a fresh operator-reviewed successor
   run. Proposed: enforce that only from stage 4, and only when a v1 run is resumed
   into a v2-opted-in context. Recommended: adopt.
5. **Grants for on-demand identities.** An MCP resource or prompt ID is minted per
   read and cannot be listed in a contract in advance. Options: a grant names the
   server, or the family namespace, or each read asks. Recommended: a grant names
   the server; an unnamed server asks.
6. **`ask` and "always".** An "always" answer must not mutate an immutable
   contract. Proposed: it stays a session-scoped approval rule as today, recorded
   against the grant, and is not written back. Recommended: adopt.
7. **Record-only stage.** Whether stage 2 may land a capability ID in durable
   receipts before enforcement exists. It changes the event vocabulary for new
   events. Recommended: yes, optional field, no reader depends on it.

## Review outcome

Astra reviewed this proposal on 2026-09-30. Stage 1 may proceed. The proposals for
decisions 1 to 4 are adopted: alias binding under v1, compiler-proposed grants with
exact operator approval, initial v2 opt-in, and successor runs. v2 stays inactive
pending review of each later stage. These amendments are binding and override the
text above where they differ:

| Amendment | Effect on the design |
|---|---|
| A missing grant means deny. Asking requires an explicit `ask` grant | Decision 5 changes: a server or capability with no grant is denied, not asked. Nothing falls back to a prompt |
| An MCP selector identifies the source and the capability family, not a display alias | A grant for MCP content names the server and one of the tool, resource or prompt families. A sanitized model-facing alias is never a selector |
| "Always" stays bound to the contract digest, the grant, the executor and the allowed scope | Decision 6 narrows: a remembered approval applies only to the same contract digest, the same grant, the same selected executor identity and the same scope. It never carries to another contract, a replaced executor or a wider target |
| A record-only decision stays distinct from enforced authorization | Stage 2 writes its computed decision under its own record type or field. It is never stored as, or read as, an authorization that was enforced |
| Historical replay is preserved, and the narrowing of future v1 execution is documented as intentional | Replay of a stored v1 run yields its original decisions. The stage 1 alias rule changes only executions that start after it lands, and its change record says so |
| v2 opt-in alone cannot establish universal gap closure | Neither `inv5.contract-grants` nor `inv5.grant-resolution` can close while v1 and contract-less execution remain the default for any in-scope path |

Binding a dependency install to its manifest content is tracked separately and is
not part of this design.

## Stage 1 as delivered

Stage 1 changes no schema, activates no v2 path and proposes no gap closure.

**Contract decisions follow the selected executor.** `decideContractTool` replaces
the alias-only check at direct dispatch, MCP dispatch, batch leaves and native
settlement. The alias of a DAX built-in names that built-in. An executor that is not
a built-in but holds a built-in's alias is not covered by the allowlist entry, and is
denied with `contract_alias_executor_mismatch`. Under that alias the built-in stays
offered, so direct dispatch, a batch leaf and a delegated child all select the same
executor.

The permission name changed only where a permission check already existed. The
dispatch wrapper asks for a loader or custom tool in a canonical run, and for an MCP
tool always. At those points an executor holding a built-in's alias is now asked
under `plugin:<alias>` or `mcp:<alias>`, so a rule written for the built-in does not
answer for it. In practice that is a governed run whose contract has an empty
allowlist, and an MCP tool whose alias matches a built-in that is not offered.

Dispatch outside a canonical run performs no wrapper permission check for a loader
or custom tool: a batch leaf invoked with no run authority, and the debug agent
command. That was so before stage 1 and is unchanged. It is deferred noncanonical
compatibility, not something stage 1 claims to govern, and no runtime scope was
added to make this paragraph read better.

**The operator shell is bound in a governed session.** Before spawning, and after
the last awaited hook, a session that has a governing contract refuses the command
when the contract does not allow `shell` or when a permission rule denies it. Only a
denial refuses: a rule that would ask is not a second prompt for a command the
operator typed. Resolving the contract and the agent both await, so the session is
read again after them and the decision is made on that snapshot: a denial installed
while authority was being resolved is a denial. If that snapshot no longer names the
governing run that was resolved, the command is refused. The authorization and the outcome are recorded on the persisted tool
part. A session with no governing contract is unchanged. An unreadable governing
reference refuses the command.

### Intentional narrowing of future execution

This changes what runs from the moment it lands. It does not change how anything
already recorded replays: stored contracts are read exactly as written, no event or
reducer changed, and a past decision is not re-evaluated.

| Before | After |
|---|---|
| A plugin, legacy custom tool or MCP tool holding a built-in's alias replaced the built-in whenever the contract's allowlist named that alias | The built-in keeps the alias. The other executor is not offered and a batch leaf does not select it |
| That replacement was asked under the built-in's permission class | When it can run at all, it is asked under its own identity |
| The operator shell ran in any session | In a governed session it is refused by a contract that does not allow `shell` and by a denying permission rule |

The operator shell is subject to the contract's allowlist and its blocklist alike,
with no implicit override. A contract compiled at native session birth uses the
`generic` workflow hint, so keyword filtering of a read-only prompt can omit `shell`
from the allowlist without blocklisting it, and the operator's shell is then refused
for that session. Treating an omission as permission would weaken authority and
would not cover the paths that blocklist `shell`. The remedy is an operator-reviewed
successor authority in a later stage, never a silent change to an existing contract.

Astra accepted the breadth of the first row on review: the narrowing applies to
every governed session whose contract has a non-empty allowlist.
The first row is wider than the proposal's wording suggested. A contract compiled at
session birth lists every available tool by name, so its allowlist is never empty.
In practice a tool that overrides a built-in by taking its name stops overriding it
in every governed session, not only under a restricted contract. Such a tool needs a
name of its own. This is what the adopted rule requires; it is called out because
overriding a built-in by name was a supported pattern.

### Not in stage 1

- Command-template shell, workflows, graph operators, workers, context reads and
  verification commands still do not consult the contract's tool lists. That is
  the shared resolution of stage 2.
- The operator shell's authorization is recorded on the session's tool part, not as
  a run journal event. The journal's executor kinds are `builtin`, `plugin` and
  `mcp`; recording an operator action there changes the event vocabulary and is
  left for the record-only stage.
- A batch leaf denied outside a canonical run has no journal to record in and is
  refused with an error, as before.

## Stage 2, first delivery: shared lookup and record-only receipts

Stage 2 adds the shared lookup and writes what it concludes. It enforces nothing,
activates no v2 path and proposes no gap closure. This first delivery covers the
tool paths and the operator shell. The remaining paths are listed below and are not
claimed.

**One lookup.** `resolveCapabilityAuthority` in
[capability/authority.ts](../../packages/dax/src/capability/authority.ts) is pure.
Its inputs are the governing contract, the selected executor's descriptor and the
target evidence the path can prove. It never takes an alias as identity.

| Governing authority | What the lookup concludes |
|---|---|
| No contract | `allow`, basis `no_contract`. The action is ungoverned, as it is today, and is recorded as such |
| v1 contract | The stage 1 executor-bound tool rule, restated. Basis `v1_contract` |
| v2 contract | A grant is required. A missing grant denies. Asking takes an explicit `ask` grant. An executor with no descriptor is denied as `capability_unenrolled` |

Every result also says who initiated the action (`model`, `operator` or `system`)
and whether the executor is enrolled. A legacy custom tool is recorded with
`enrolled: false` and no capability ID: none is invented for it.

**Grants.** The schema in
[capability/grant.ts](../../packages/dax/src/capability/grant.ts) follows the
review amendments. A grant's subject is a capability ID, or an MCP source: the
configured server and one family of tool, resource or prompt. A source selector
matches only when the claimed server and item name re-mint the exact identity being
resolved, so a display alias can never satisfy it. There is no `deny` grant. The v2
contract format is defined and inactive: the guardian refuses to write or read it.

**Record only, and distinct from enforcement.** The conclusion is appended to the
run journal as `capability_resolution_recorded`. Its `enforcement` field is the
fixed literal `record_only`, so the schema itself refuses a record that claims to be
enforced, and it carries no authority-bearing field. The decision that is enforced
stays in `authorization_recorded`, unchanged. The reducer keeps resolutions in their
own list and reads none of them for authority: a recorded deny does not deny, a
recorded allow does not authorize, and a log with the resolutions removed replays
to the same authority state.

For a tool the order in the journal is invocation, resolution, authorization. An
append failure for the resolution refuses the invocation, as an append failure for
the invocation already does.

| Path | Recorded | Identity recorded |
|---|---|---|
| Native tool, direct and queued task | Yes, in a canonical run | `native.tool.<id>` |
| Loader and opt-in custom tool | Yes, in a canonical run | `plugin.tool.v1.*` |
| Legacy custom tool | Yes, in a canonical run | none; `enrolled: false` |
| MCP tool | Yes, in a canonical run | `mcp.tool.v1.*`, with its server and tool name as the proven source |
| Batch leaf | Yes, as `batch_leaf`, separately from the batch | the leaf's own |
| Operator shell | Yes, when the governing run has a journal | `session.shell.operator`, initiator `operator` |

An operator action has no authorization event. Its shadow record covers the contract
only; a permission rule that refuses it is a separate, enforced refusal recorded on
the session's tool part.

### Not recorded yet

| Path | Why |
|---|---|
| Command-template shell, attachments, template references, MCP resources and prompts | Not wired in this delivery |
| Fixed workflows, workers, verification commands | Not wired in this delivery |
| Graph operators from `dax workflow` and `dax explore` | Operator-direct with no run journal to write to |
| Any dispatch outside a canonical run | No journal exists; nothing is recorded, as before |

### Compatibility

The new event type is part of the development event vocabulary. A journal that
contains it cannot be read by a binary that predates it, including the published
v1.5.0. That was already true of development journals. Earlier journals contain no
such event and replay unchanged.

## Acceptance evidence planned

- A plugin named `read` is denied under a read-only contract, through the real
  prompt path, with zero plugin calls.
- The operator shell in a governed session is denied by a blocklisted `shell` and by
  a denying permission rule, spawns nothing, and records the denial. Outside a
  governed session it behaves as today.
- Equivalent requests get the same decision through direct dispatch, a batch leaf,
  a delegated child and a queued task. A denial on one cannot be bypassed on another.
- A stored v1 contract, reloaded after restart, yields the decisions it yielded before.
- A v2 contract serializes and reloads without changing meaning; a v2 contract with
  a v1 field mix, a duplicate grant or an unknown capability ID is rejected at write.
- A child cannot obtain a grant its parent lacks.
- Interruption between approval and effect is distinguishable from an uncertain
  external outcome, and is not retried automatically.

## Out of scope here

Formatter and LSP configuration trust, plugin hook containment, the legacy
executors' enrollment path, and any change to stored contracts or released binaries.
