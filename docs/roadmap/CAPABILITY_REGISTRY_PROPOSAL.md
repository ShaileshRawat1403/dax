# Capability identity and intrinsic properties — proposal only

Owner: Sol. Architecture/Tier 2 reviewer: Astra. Recorded 2026-09-26.
Inspected baseline: `0170d2f8137bbd0abab7d9f6d72837ca5cec59f0` (fetched
`main` and `origin/main`, clean maintainer checkout). No runtime changes,
contract migration, permission-policy replacement, or ledger closure are proposed
in this documentation branch. Published v1.5.0 is unchanged.

## Smallest useful boundary

Introduce a dependency-light, runtime-validated identity registry, consumed at
real dispatch boundaries. An executor identity resolves to exactly one descriptor;
unknown identities, malformed descriptors, duplicate IDs, and duplicate executor
bindings are errors before dispatch. A descriptor answers **what the operation
is**, never **whether this run may perform it**. Registration is not approval.
The tiny version fails if it is just another unused inventory, or if an alias,
batch leaf, dynamic plugin, or command path escapes its lookup.

Proposed `capability/capability-types.ts`: a strict Zod descriptor containing
`id`, `riskClass` (`low | medium | high`), `scopeSupport`
(`none | filesystem | delegation | opaque`), and `requiresVerification` (boolean).
All fields required, no authority-bearing defaults. `opaque` explicitly means
internal effects cannot be constrained by descriptor metadata; it does not claim
filesystem scope enforcement. Unknown fields reject, including paths, hosts,
budgets, allow/deny rules, approval overrides, and grant fields. Risk/verification
are conservative intrinsic lower bounds, not substitutes for existing policy.
An operation marked false for verification cannot turn off a contract's required
verification. A true value cannot pretend a verification receipt already exists.

Proposed `capability/registry.ts`: construct a validated immutable snapshot from
reviewed built-ins and enrolled dynamic executor identities; expose lookup, not
execution or an `isAllowed` API. Validate the whole snapshot before publishing it
(no partial registration on failure). Keep executable references out of descriptors
and policy modules free of tool-implementation import cycles. Keep
`tool/tool-class.ts`'s legacy classification in place initially; do not silently
replace mutation observation or permission categories with descriptor risk.

Use identities preserving provenance, not ambiguous bare tool names:
`native.tool.<id>`, `plugin.tool.<source>.<export>`,
`mcp.tool.<server>.<tool>`, `workflow.<class>`, `worker.execute.<profile>`,
`operator.<type>.<action>`, `session.command.shell`, and `mcp.resource.read`. Encode/validate segments
bijectively; reject collisions rather than sanitize two names into one. Native
edit/write/apply_patch remain distinct identities; legacy aliases map explicitly
only where the runtime really supports them. Arbitrary shell is `shell`, not
inferred `git.patch` authority from command text. Workflow identities identify
orchestration; they never grant all of their leaf effects.

## Production inventory and existing checks

Paths below are relative to `packages/dax/src` at the inspected SHA. This is an
inventory of reviewed boundaries, not a claim that one resolver exists today.

| Surface and production entry point | Identity mapping and checks to preserve |
| --- | --- |
| `tool/registry.ts:all/tools`, `session/prompt.ts:resolveTools` | Every returned built-in Tool.Info, including conditional batch/LSP/plan tools and non-workspace effects (todo, pm_note, reflection, git_branch). Native wrappers filter contract tool lists, begin native settlement, perform governed ask, then seal authorization. Edit/write/apply_patch also check protected/external paths and file-time; shell checks permissions and sandbox. Catalog must cover observation tools too, not label all reads pure or all LSP operations non-mutating by assumption. |
| `tool/batch.ts:execute` | Each leaf resolves its own identity/contract immediately before nested dispatch; preserve per-leaf permission identity, input/result validation, durable authorization and parent linkage. A granted batch container cannot grant its children. |
| `tool/registry.ts:state/fromPlugin/register`, `plugin/index.ts` | Directory tools and plugin exports need stable source-qualified identities. Current register replaces same IDs; capability enrollment must reject duplicate bindings, not inherit replacement semantics. Preserve string/domain result validation and conservative mutation observation. Plugin module loading/hooks execute arbitrary trusted in-process code; tool enrollment does not sandbox those hooks. Do not claim containment of arbitrary plugin internals; extending that trust boundary requires a separately reviewed plugin API/isolation change. |
| `mcp/index.ts:tools/convertMcpTool`, `session/prompt.ts:resolveTools` MCP wrapper | Preserve raw server/tool identity before sanitized model names (current joined sanitized names can collide). Resolve before transport call; retain contract filter, per-tool Permission ask, settlement, validated protocol/transport result and conservative observation. Descriptors must not trust external server annotations as permission. |
| `tool/task.ts:execute`, queued subtask dispatch in `session/prompt.ts` | `native.tool.task` covers dispatch, not child rights. Preserve ask/authorize before fork, durable delegation receipt, governingRunId inheritance, refusal to adopt a child from another contract, and child per-action checks. Agent name/model choice never grants authority. |
| `execution/run-factory.ts` workflow dispatch, `workflows/registry.ts:createWorkflow` | Enumerate draft_and_approve, repo_analyze, review_and_signoff, worker_run; unknown workflow currently unavailable. Preserve durable contract/run creation and approval/signoff semantics. Draft publishes an artifact, not an applied patch; repo analysis is template/report orchestration. Do not add fictitious execution kernels. `workflows/builtin-workflows.ts` is planner task-graph presets, not this executor registry; inventory the dispatched leaf operators separately. |
| `execution/run-graph.ts:runGraph`, `operators/router.ts`, `cli/cmd/workflow.ts`, `cli/cmd/explore.ts`, `session/prompt.ts` Explore command path | Graph dispatch calls operator.execute directly, distinct from native settlement. Registered types are explore/git/verify/release/artifact; unknown type rejects, but registration currently replaces duplicate types. `operators/git.ts` performs real add/commit/push/checkout/status; report operators write through `operators/report-artifact.ts`. These are consequential alternate boundaries, not proven covered by contract tool lists; later integration must preflight before leaf effects, not treat post-execution governance or a report's trust score as authorization. Map git actions individually and report-producing actions explicitly; distinguish report verification from real command verification. |
| `workflows/worker-run.ts:execute/executeRunWorker`, `worker/worker-adapter.ts` profiles and `worker/worker-sandbox.ts` | Enroll claude/codex/gemini/antigravity profile identities; constrain launch and verification effects separately from workflow selection. Preserve auth/model preflight, disposable checkout, filtered env, Seatbelt/bwrap, egress proxy, DAX-computed patch scope/forbidden-path checks, verification and operator patch-artifact approval. Worker capability lists/prompts are descriptive, not confinement. Patch approval does not automatically apply to maintainer checkout. |
| `session/prompt.ts:command` shell-template expansion | `session.command.shell`: existing Permission.ask(shell) and Sandbox.wrap are not the ordinary native settlement wrapper. Must receive explicit identity/contract integration before claiming universal enforcement; do not rely on model-tool filtering. |
| `session/prompt.ts:resolvePromptParts`, `mcp/index.ts:readResource`; direct prompt-time read/list calls | Resource reads and prompt file/directory expansion bypass model tool wrappers, with some no-op ask/authorize contexts. Inventory as context-contribution effects and specify applicable read grants; do not silently call them ordinary governed tools or assert present contract enforcement. Provider calls and internal journal/artifact writes remain system lifecycle effects, not model-selectable grants; no model capability to mutate their authority. |

Follow all exports/callers of these boundaries before implementing. The inventory
is not a promise to retrofit everything in one commit. Planner operator dispatch
and plugin hooks require a final caller audit before universal closure. Any newly
discovered consequential entry point must be explicitly enrolled or left reported
as uncovered; it cannot be exempted to make a test green. The inspected graph/CLI
paths above are already known coverage obligations, not merely a hypothetical
future audit finding.

## Bounded implementation sequence (requires Astra approval)

1. Schema/registry plus native production enrollment/lookup, tests exercising
   ToolRegistry and direct/nested dispatch, preserving known-operation decisions.
   Reject unknown/duplicate entries before effects. No contract schema change.
   Keep both vocabulary/property ledger entries open while other dispatches are
   uncovered; do not create expected files without replacing their inverted
   filename checks with ordinary tests of the enrolled behavior.
2. Separate adapter slice: dynamic plugin/MCP identities and workflow/worker,
   delegation, command/context entry points. Test production dispatch and
   rejection before effect; make no plugin-isolation claim. Only after independent
   review of complete coverage may vocabulary/properties be closed. If dynamic
   metadata needs a plugin/MCP interface change, propose that bounded interface
   first rather than permitting unknown capabilities.
3. Contract grants: separately versioned, operator-reviewed immutable grants
   carrying capability ID and run-specific scope/hosts/budgets/verification.
   Serialize/reload with meaning preserved, include exact governing contract in
   receipts. No auto-grants from registry, model, provider, or plugin metadata.
4. Shared resolver/enforcement: combine grant lookup with current approvals,
   runtime guard, permission rules and sandbox/scope checks at each first-effect
   boundary. A grant is necessary, never sufficient; any denial dominates.
   Equivalent requests must produce equivalent allow/ask/deny outcomes across
   direct/batch/delegated/worker/command entry, with narrower child authority
   never widened. Verification and durable authorization precede accepted
   completion as today. Receipts must distinguish grant eligibility from final
   authorization and reference the governing immutable contract/grant.
5. Scoped journal primitive/envelopes, project journal, then operator-governed
   memory candidate/promotion/supersession/retirement. Run and project facts each
   have one authoritative journal; provenance references do not duplicate
   authority. A model may propose a candidate, not authorize persistence.

## Historical compatibility decision

Registry-only enrollment leaves existing v1 contracts and receipts intact.
Current `isToolAllowedByContract` allows a no-contract native path, treats an
empty allowlist as unrestricted, and gives blocklist precedence. Do not rewrite
that as new scoped grants or imply unknown scope means explicit operator consent.
Existing governed children require their parent's valid stored contract.

For the later grant slice, propose explicit v2 opt-in for new governed runs:
missing grants deny, unknown IDs reject, block/forbidden rules dominate; old v1
contracts remain replayable under identified legacy semantics, never silently
upgraded to v2. Resuming legacy consequential execution should require a fresh
operator-reviewed successor run/contract rather than mutating the original or
inventing grants. Historical replay must not load today's registry as retroactive
authority. The legacy no-contract interactive path needs an explicit operator
compatibility decision before shared enforcement closes; it cannot remain a
hidden escape hatch or be silently disabled by this initial slice.

## Behavioral acceptance and proposed files

Runtime files initially limited to `capability/capability-types.ts`,
`capability/registry.ts`, `tool/registry.ts`, the narrow native dispatch integration
in `session/prompt.ts`/`execution/native-settlement.ts`, and `tool/batch.ts` if
needed for direct nested rejection. Add `capability/*.test.ts` and production
conformance regressions in `conformance/contract-capability.test.ts`; no event,
contract, model-dispatch, completion, or memory schema in the first slice.
Adapter and grant/enforcement files above belong to later branches, not this one.

- Unknown native/dynamic identity and ambiguous duplicate fail before hooks,
  transport/process spawn or mutation; counter/spies assert zero executor calls.
- Malformed descriptor (bad enum/type, missing required field, authority-bearing
  extra field) rejects atomically; duplicate source/export and name-encoding
  collisions reject without replacing a reviewed capability.
- Known read/write/shell/task actions retain baseline allows, asks, blocklist
  denials, protected-path rejection, scope/forbidden-path denial and required
  verification. Making risk low or requiresVerification false cannot weaken them.
- Direct, batch leaf, delegated child, plugin/MCP, workflow/worker and command
  routes cannot bypass unknown-capability rejection; later grant slice adds
  absent/out-of-scope denial and alternate-entry equivalence. Use production
  dispatch, with only actual external side effects controlled, not source regex
  or hand-built events as enforcement proof.
- Reload v1/v2 contracts and restart/replay retain original authority semantics;
  denied/revoked grants never reappear as default allows. Missing historical
  metadata is unavailable, not inferred consent. Interruption before effect
  remains distinguishable from an uncertain external outcome.

Each runtime slice requires pinned Bun 1.4.0 focused regressions and full
`release:gates`, retained raw evidence outside discovery, exact pushed-SHA green
Ubuntu/macOS/Windows CI and independent Astra review before integration. Actual
UI submission/reopen acceptance is required if operator-visible behavior changes.
For this prose-only branch, evidence/link checks and `git diff --check` are the
diff-appropriate local gates under the SOP; CI is still observed at its exact SHA.
No release/tag/binary changes, aesthetics, additional agent framework, or claimed
gap closure. Running-label and intermittent-test observations remain separate.

Astra's decision requested: approve or refute this identity/schema boundary,
native-first coverage plan, dynamic identity/trust treatment and proposed legacy
execution compatibility before runtime implementation.
