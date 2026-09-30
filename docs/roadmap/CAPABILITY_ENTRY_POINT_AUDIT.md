# Capability vocabulary and properties: entry-point audit

Implementer: Claude Opus 5.5, on `feat/conformance-execution-opus`, created from
`3c47d1a3045fa311bba4755d3aff8c5735e1baa2`. Reviewer: Astra. This is workstream 1
of the execution-ownership handover. Paths are relative to `packages/dax/src`.

The audit was first recorded on 2026-09-30 at `6bb67da39a20adf6b0d1e0a396be0c4c799ba182`.
Astra reviewed it, corrected two of its findings, and fixed the scope. This
revision applies those corrections and records the first delivery built on them.
Nothing here is an accepted gap closure.

## Verdict

Both `inv5.capability-vocabulary` and `inv5.capability-properties` stay open. Every
DAX-dispatched family now resolves through one composed vocabulary. The gaps remain
because legacy custom tools and caller-supplied graph operators still dispatch
without a descriptor, and that legacy path is kept compatible by decision.

| Item | Value |
| --- | --- |
| Proposed closures | None |
| Declared population | 13 families, 50 static descriptors, 2 dynamic and 2 on-demand families |
| Remaining uncovered executors | Legacy `ToolRegistry.register` tools; caller-supplied graph operators |
| Authority findings carried to workstream 2 | 2, both still reproducible by probe |

## Corrections to the first revision

The first revision reported two observations as defects. Neither is one.

- **Descriptor properties have no production reader.** This is intended.
  `riskClass`, `scopeSupport` and `requiresVerification` must be validated
  descriptors. They must not become a second permission system, so nothing should
  decide an allow, ask or deny from them. Recording a capability ID in a durable
  receipt belongs to the grant and enforcement delivery, not to this one.
- **There are several family registries.** This is acceptable provided they
  compose into one validated vocabulary. They now do. Each family keeps its
  registry beside the executor it describes.

## Binding scope decisions

Recorded from Astra's review, relayed by the maintainer on 2026-09-30.

| Decision | Consequence |
| --- | --- |
| The population is DAX-dispatched tool, command, verification, workflow, worker and context actions | These must resolve in the vocabulary before closure |
| Formatter, LSP and MCP process launches are service lifecycle effects | Classified below with their parent boundary; not enrolled; no generic process-governance framework |
| Trusted plugin loading and hooks are a documented exclusion | Identity enrollment cannot contain arbitrary trusted in-process code |
| Legacy registration stays compatible for now | "No repository callers" does not prove an API has no external users. The future governed path requires explicit enrollment. Unresolved legacy coverage prevents universal closure |

## Declared population

"Enrolled" means a production caller resolves a validated descriptor and rechecks
the bound executor before the effect. It never means authorized.

| Family | Namespace | Production entry point | State |
| --- | --- | --- | --- |
| Native model tools | `native.tool.` (22) | `session/prompt.ts:1298`, `tool/batch.ts:84`, queued task `session/prompt.ts:688`, `cli/cmd/debug/agent.ts:56` | Enrolled |
| Loader plugin and opt-in custom tools | `plugin.tool.v1.` (dynamic) | `tool/registry.ts` `discover`, `registerEnrolled` | Enrolled |
| MCP tools | `mcp.tool.v1.` (dynamic) | `session/prompt.ts:1401`, `mcp/tool-identity.ts` | Enrolled |
| MCP resources | `mcp.resource.v1.` (on demand) | `mcp/index.ts` `readResource` | Enrolled |
| MCP prompts | `mcp.prompt.v1.` (on demand) | `mcp/index.ts` `getPrompt`, reached from `command/index.ts:146` | Enrolled in this delivery |
| Built-in graph operators | `operator.` (9) | `execution/run-graph.ts:111`, `operators/router.ts:55` | Enrolled |
| Fixed workflows | `workflow.` (6) | `workflows/*.ts` execute and resume methods | Enrolled |
| External workers | `worker.profile.` (4) | `workflows/worker-run.ts:94,124,339,386` | Enrolled |
| Command-template shell | `session.command.` (1) | `session/prompt.ts` `command` | Enrolled |
| Operator session shell | `session.shell.` (1) | `session/prompt.ts` `shell`, route `server/routes/session.ts:852` | Enrolled in this delivery |
| Prompt attachments | `session.context.attachment.` (4) | `session/prompt.ts` `resolvePromptParts` | Enrolled |
| Template references | `session.context.template.` (1) | `session/prompt.ts:489` | Enrolled |
| Verification commands | `verification.command.` (2) | `sdlc/check-runner.ts` `runCheck`, `worker/worker-sandbox.ts` `runSandboxedWorkerCheck` | Enrolled in this delivery |
| Legacy custom tools | none | `tool/registry.ts` `register` | Compatible, unenrolled; keeps both gaps open |
| Caller-supplied graph operators | none | `operators/router.ts:53` | Compatible, unenrolled; keeps both gaps open |

The `generic` workflow class has no workflow identity because it runs the session
loop; its effects are native tool calls. Flowright's `dax.<workflow>` names are an
external API namespace that reaches an enrolled fixed workflow.

### How the vocabulary composes

[capability/vocabulary.ts](../../packages/dax/src/capability/vocabulary.ts)
composes families into one immutable value. Each family owns a namespace. An ID
outside its family's namespace is rejected, and two namespaces may not be prefixes
of each other, so no two families can mint the same ID.
[capability/catalog.ts](../../packages/dax/src/capability/catalog.ts) declares the
population and produces a snapshot for the current instance. There is no mutable
global: a snapshot is composed on request from the static families and whatever the
instance's loader and MCP catalogs currently hold as valid. It performs no
discovery. Invalidated or disposed entries are absent from the next snapshot, and
an earlier snapshot is not rewritten.

MCP resources and prompts mint one source-qualified ID per read. They cannot be
listed in advance, so their families are `on_demand`: the vocabulary owns the
namespace and reports it as covered, and `require` does not resolve those IDs.

## Service lifecycle effects

These launch processes as a side effect of something else. They are classified, not
enrolled. The column that matters is the parent boundary that authorizes them.

| Effect | Launch site | Triggered by | Parent authorization | Command source |
| --- | --- | --- | --- | --- |
| Formatter | `format/index.ts:113` | `File.Event.Edited` after an edit, write or patch | The edit tool call's permission and contract check | Built-in formatters and `formatter` config |
| LSP server | `lsp/index.ts:113`, `lsp/server.ts` | `LSP.touchFile` from read, edit, write, patch and the `lsp` tool | The triggering tool call; a plain `read` is enough | Built-in servers and `lsp` config; may download unless `DAX_DISABLE_LSP_DOWNLOAD` |
| MCP stdio server | `mcp/index.ts:538` | Instance start for each enabled `mcp` config entry; `MCP.add` and `MCP.connect` from `server/routes/mcp.ts:59,313` | None per launch. Config presence, or an operator API call | `mcp.<name>.command` config |

Two properties follow and are recorded as limitations, not fixed here. A formatter
or LSP command runs under its parent's authorization without being named in it. An
MCP stdio command runs at instance start with no per-launch authorization. In each
case the command comes from configuration, including project configuration.

## Documented exclusion: trusted plugin code

Plugin modules are imported and initialized in-process (`plugin/index.ts:91`,
`tool/registry.ts:207`) and receive `Bun.$` and a client. Their hooks run inside
dispatch (`Plugin.trigger`). Enrolling a plugin's tool gives that tool an identity
and rechecks its executor. It does not confine the module, its initialization, or
its hooks, and no claim of containment is made.

## Findings

### Authority boundary, carried to workstream 2

| Issue | Location | Severity | Status |
| --- | --- | --- | --- |
| Contract allowlist and permission class are keyed by alias, so a loader tool named `read` runs opaque effects inside a read-only contract | `execution/execution-contract.ts:150`, `tool/tool-class.ts:59`, `session/prompt.ts:1290,1331` | High | Open. Grants must resolve by the selected executor's capability identity, never its alias |
| Operator session shell runs with no contract check, permission ask, or native invocation record | `session/prompt.ts` `shell` | High | Identity enrolled. Enforcement open: in governed sessions it must respect contract and permission denials before spawning, and record authorization and outcome |

Both are demonstrated by
[capability-inventory-audit.test.ts](../../packages/dax/src/conformance/capability-inventory-audit.test.ts).
Those probes assert that the bypass succeeds. They are characterization, and each
becomes a negative regression when its fix lands. They must not remain as permanent
assertions of bypass success.

### Vocabulary

| Issue | Location | Severity | Status |
| --- | --- | --- | --- |
| Legacy custom tools and caller-supplied operators dispatch without a descriptor | `tool/registry.ts` `register`, `operators/router.ts:53` | Medium | Open by decision; keeps both gaps open |
| Session shell, MCP prompts and verification commands were outside the vocabulary | see population table | Medium | Fixed in this delivery |
| Aggregate gap check probed only `register(tool)` | `conformance/contract-capability.test.ts` | Medium | Replaced with production-backed coverage and rejection controls |
| No composed vocabulary | `capability/catalog.ts` | Medium | Fixed in this delivery |
| `list` and `todoread` tools are defined without native descriptors; `list` runs through the attachment path under its context identity | `tool/ls.ts:38`, `tool/todo.ts:36`, `session/prompt.ts:1875` | Low | Open; neither is offered to the model |
| Implemented ID shapes differ from the approved proposal | `docs/roadmap/CAPABILITY_REGISTRY_PROPOSAL.md:38-41` | Low | Open; record the implemented scheme as reviewed |

### Classification lists

| Issue | Location | Severity | Status |
| --- | --- | --- | --- |
| Operative tool classification is a name-keyed list that can disagree with a descriptor | `tool/tool-class.ts:24-30`, `execution/native-settlement.ts:166` | Low | Open; part of the alias finding above |
| Compiler default tool list names tools that do not exist (`bash`, `search`, `browser`, `todo`) | `execution/compiler.ts:20` | Low | Open; check callers that omit `availableTools` |

## Behavior changes in this delivery

Coverage was made explicit without changing what is permitted. Three outcomes
differ from the baseline, all on a changed or stale identity:

- `MCP.getPrompt` now rejects with a capability identity error when its source
  disconnects, its instance changes, or its client method is replaced mid-flight.
  The baseline returned `undefined` or the late result. An ordinary server failure
  and an unknown client still return `undefined`.
- The operator session shell rejects before spawning if the submitted command
  changes during the awaited `shell.env` hook.
- A verification runner rejects a check whose argv changes after binding. Through
  `verifyWorkerPatch` that becomes a blocking `error` result, as any runner crash does.

## Residual risk

- Project `.dax/tool/*.{js,ts}` appears to be imported at discovery
  (`config/config.ts:231-238`, `tool/registry.ts:199-207`) before any approval.
  Read from source only; not exercised by a run. It falls under the trusted plugin
  exclusion, which makes the project-configuration trust boundary the thing to review.
- Operator direct actions other than the session shell (revert, worktree routes,
  PTY) were classified by reading call sites and are not in the declared population.
- `cli/cmd/*` commands that spawn `git` and `gh`, and ACP and Soothsayer entry
  points past the session and run-gateway boundaries they call, were not traced.
- The real operator-shell dispatch tests are skipped on Windows because the probe
  command is POSIX shell. The identity unit controls run on every platform.
- The sandboxed verification runner has no seam between binding and its process
  effect, so its changed-identity control is at the binding functions, not dispatch.

## Next actions

1. Grant and enforcement delivery: resolve authority by capability identity,
   enforce contract and permission on the operator shell, convert both probes to
   negative regressions. Specify legacy and no-contract compatibility before
   activation; do not reinterpret stored contracts or invent grants.
2. Adopt the preparatory grant branches only after their slice-to-SHA mapping is
   verified against the tree.
3. Decide the governed path for legacy executors. Until then both gaps stay open.
