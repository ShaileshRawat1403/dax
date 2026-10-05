# Capability vocabulary and properties: entry-point audit

Implementer: Claude Opus 5.5, on `feat/conformance-execution-opus`, created from
`3c47d1a3045fa311bba4755d3aff8c5735e1baa2`. Reviewer: Astra. This is workstream 1
of the execution-ownership handover. Paths are relative to `packages/dax/src`.

The audit was first recorded on 2026-09-30 at `6bb67da39a20adf6b0d1e0a396be0c4c799ba182`.
Astra reviewed it, corrected two of its findings, and fixed the scope. This
revision applies those corrections and records the first delivery built on them.
Nothing here is an accepted gap closure.

## Candidate update — 2026-10-05

Codex's caller-registration correction, validated at `9e3cbef`, addresses the
last descriptor omissions identified below. Both vocabulary and intrinsic
property entries are proposed closed in the feature-stack ledger. Accepted
main remains unchanged with eight open gaps; this is solo validation, not
independent cross-validation or integration acceptance.

The current composed catalog has 17 families: nine static listed families
(50 descriptors), two dynamic listed families, and six on-demand families
(MCP resource/prompt v1/v2 plus caller tools and operators). Caller names map
to strict conservative logical identities, bound to actual executor functions
and receivers. These identities provide no source attestation and no permission.
Trusted plugin hooks/loading and service lifecycle effects retain the explicit
scope decisions below. Caller tools remain excluded from reviewed grants when
there is no implementation binding; existing v1 compatibility is preserved.

Production controls include direct and batch dispatch, native-alias collisions,
replacement and stale handles, graph dispatch and post-selection mutation,
malformed descriptor rejection, namespace composition, and real review capture
refusing to turn an acknowledged caller descriptor into a grant.

[Validation and durable evidence](../tooling/legacy-runtime-descriptors-validation.md).

## Original delivery verdict (superseded for the candidate)

Both `inv5.capability-vocabulary` and `inv5.capability-properties` stay open. Every
DAX-dispatched family now resolves through one composed vocabulary. The gaps remain
because legacy custom tools and caller-supplied graph operators still dispatch
without a descriptor, and that legacy path is kept compatible by decision.

| Item | Value |
| --- | --- |
| Proposed closures | None |
| Declared population | 13 families, 50 static descriptors, 2 dynamic and 2 on-demand families |
| Remaining uncovered executors | Legacy `ToolRegistry.register` tools; caller-supplied graph operators |
| Authority findings from the first audit | 2, both fixed in grant stage 1 and held by negative regressions |

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
instance's loader and MCP catalogs currently hold as valid. Enumeration reads only
state the instance already created and never creates it: a snapshot of a fresh
instance opens no MCP connection and launches no process. Discovery
(`ToolRegistry.tools`, `MCP.tools`) is what initializes that state. Invalidated or
disposed entries are absent from the next snapshot, and an earlier snapshot is not
rewritten.

The first delivery at `27cd8947d2d6317638015c689dece9f323a2929e` claimed this and
did not do it: `MCP.capabilities()` called the initializing state accessor, so a
fresh snapshot made four MCP HTTP requests. Astra's review reproduced it. The
correction adds a non-initializing `peek` to instance state and a regression that
counts requests and process launches.

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
| MCP stdio server | `mcp/index.ts` `create` | First use of MCP state, for each enabled `mcp` config entry; `MCP.add` and `MCP.connect` from `server/routes/mcp.ts:59,313` | None per launch. Config presence, or an operator API call. A project-declared local server is withheld until the operator trusts the worktree (`project/trust.ts`) | `mcp.<name>.command` config |

Two properties follow and are recorded as limitations, not fixed here. A formatter
or LSP command runs under its parent's authorization without being named in it. An
MCP stdio command runs when MCP state is first used, with no per-launch
authorization. Workspace trust withholds project-declared plugins, local MCP
servers and dependency installs until the operator trusts the worktree. It does not
track project `formatter` or `lsp` configuration.

## Documented exclusion: trusted plugin code

Plugin modules are imported and initialized in-process (`plugin/index.ts:91`,
`tool/registry.ts:207`) and receive `Bun.$` and a client. Their hooks run inside
dispatch (`Plugin.trigger`). Enrolling a plugin's tool gives that tool an identity
and rechecks its executor. It does not confine the module, its initialization, or
its hooks, and no claim of containment is made.

## Findings

### Authority boundary

| Issue | Location | Severity | Status |
| --- | --- | --- | --- |
| Contract allowlist and permission class were keyed by alias, so a loader tool named `read` ran opaque effects inside a read-only contract | `execution/execution-contract.ts` `decideContractTool`, `capability/native-alias.ts` | High | Fixed in grant stage 1: a contract decision follows the selected executor |
| Operator session shell ran with no contract check or permission check | `session/operator-shell-authority.ts`, `session/prompt.ts` `shell` | High | Fixed in grant stage 1: a governed session's contract and permission denials bind it before spawning |

Both were demonstrated by probes that asserted the bypass succeeded. Those probes
are now negative regressions in
[grant-stage1.test.ts](../../packages/dax/src/conformance/grant-stage1.test.ts).
The [grant compatibility design](GRANT_COMPATIBILITY_DESIGN.md) records what stage 1
changed and what it intentionally narrows.

### Trust boundary

| Issue | Location | Severity | Status |
| --- | --- | --- | --- |
| A project's `.dax/tool/*.{js,ts}` was imported and offered at tool discovery in a worktree with no trust record. Workspace trust tracked plugins, local MCP and installs, not tool files | `tool/registry.ts` `discover`, `config/config.ts` | High | Fixed in a separate slice after Astra reproduced it |
| A project's local plugin file was approved by path, not content, so editing an approved plugin did not ask again | `project/trust.ts` `digest`, `config/config.ts` `loadPlugin` | Medium | Fixed in a separate slice, approved by Astra |
| A project's dependency install is approved by directory, not by `package.json` content | `project/trust.ts` `digest`, `config/config.ts` | Medium | Open; tracked separately by decision, not part of these slices |
| Project `formatter` and `lsp` configuration is not tracked by workspace trust | `config/config.ts`, `format/index.ts`, `lsp/index.ts` | Medium | Open; see service lifecycle effects |

The fix puts every file under a project's `.dax/tool` and `.dax/tools` into the
existing trust decision, each bound to its path and a SHA-256 of its content.
Config load scans them without importing. Discovery re-reads them and imports only
while they are exactly the approved set, so a file added, edited or removed after
approval withholds that project's tools at once and again after a restart.
Operator-owned global, home and `DAX_CONFIG_DIR` tool directories are untouched.

The inventory is complete or it is a failure. Only a tool folder that does not
exist counts as absent. A folder, entry or file that cannot be resolved, listed,
inspected or read makes the set of tool files unknown, and `dax trust` refuses to
approve an unknown set. An entry without a real content digest is never approvable.

The two checks withhold different things, and neither revokes anything already
running:

| Check | When | What a mismatch or failure withholds |
| --- | --- | --- |
| Config load | Once, when an instance loads its config | The project's executable configuration for that instance: plugins, local MCP servers, dependency installs and tool files |
| Tool discovery recheck | Each tool discovery | That project's tool files only |
| Plugin load recheck | Once, when an instance first loads plugins | That project's plugins only |

A recheck does not unload a module that was already imported, stop a running MCP
server, or change the trust record. The record is re-evaluated at the next config
load.
The first version of this fix at `3e13bba0d453e3ab67d2cd54feff03cd20801203`
turned a failed folder scan into an empty inventory and recorded an unreadable
file as an approvable `unreadable` entry. Astra reproduced an import through each.

Plugin files are bound the same way. Every file under a project's `.dax/plugin`
and `.dax/plugins`, and any other local file a project config names as a plugin,
enters the trust decision with its content digest and is rechecked immediately
before plugins are imported. A package specifier stays identified by name and
version. A named plugin file that does not exist is a failure, not an absent plugin.

Approval binds content, and the runtime caches a module for the life of the
process. Once a project file has been imported, importing that path again returns
the cached module whatever the file now contains. So when approved content differs
from content this process already imported, the project's tools or plugins are
rejected with a stable restart-required error and nothing is imported or
initialized, until the process restarts. The comparison covers the whole approved
inventory, not only entry modules, so a changed helper is rejected even when the
entry file is unchanged, and a loaded file that has since been removed counts too.
Content restored to exactly what was loaded runs again, and a file never loaded in
this process imports fresh. The record is kept by real file path, because the
module cache follows the real file: the same project opened through a symlink or
a second worktree path is recognized as content already loaded. The version at
`1c6f6dbda6c56e9310f46f661dc993fcf2bf4bb7` lacked this: after load A, edit and
approve B, and a recreated instance, both loaders still ran cached A. Astra
reproduced it for tools and plugins.
[content-cache.test.ts](../../packages/dax/src/project/content-cache.test.ts)
observes the version that actually executes, including in a process of its own.

Tools and plugins classify one directory differently, and this is left as it is.
A home `~/.dax` that lies above a project with no repository is operator-owned for
tools, so its tools load without a prompt. Plugin loading has always treated that
same directory as project-scoped, so its plugins wait on the project's trust.

Compatibility is explicit: a trust record written earlier stays valid for a
worktree with no project tool files and no local project plugin files. It never
approves a tool file, and it approved a plugin file only by path, so a worktree
that has either is withheld as a whole until `dax trust` is run again. Limits: imports
from outside the tool and plugin folders and from `node_modules` are not covered,
and there is a narrow window between the content check and the import.
[tool-trust.test.ts](../../packages/dax/src/project/tool-trust.test.ts) keeps the
reproduction as a regression, and
[plugin-trust.test.ts](../../packages/dax/src/project/plugin-trust.test.ts) covers
plugin files.

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
  changes during the awaited `shell.env` hook. The tool part it had already
  persisted as running is settled as an error and the assistant message is
  completed, so the history has no unfinished record and reads the same after the
  session is reopened. A `shell.env` hook that throws is settled the same way and
  keeps its own error; at the baseline it left a running part behind. The first
  delivery rejected correctly and left that part running, which Astra reproduced.
- A verification runner rejects a check whose argv changes after binding. Through
  `verifyWorkerPatch` that becomes a blocking `error` result, as any runner crash does.

## Residual risk

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
