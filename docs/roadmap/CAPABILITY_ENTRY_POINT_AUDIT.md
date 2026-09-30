# Capability vocabulary and properties: entry-point audit

Recorded 2026-09-30. Implementer: Claude Opus 5.5, on `feat/conformance-execution-opus`,
created from `3c47d1a3045fa311bba4755d3aff8c5735e1baa2`. Reviewer: Astra. This is
workstream 1 of the execution-ownership handover: an audit of every production
execution entry point against actual capability enrollment. It proposes no gap
closure and changes no runtime behavior. Paths are relative to `packages/dax/src`.

## Verdict

Neither `inv5.capability-vocabulary` nor `inv5.capability-properties` can close at
this baseline. Enrollment is real and behaviorally tested for the families Sol
delivered, but the vocabulary is not one registry, its properties decide nothing,
and several consequential entry points sit outside it.

| Item | Value |
| --- | --- |
| Baseline inspected | `3c47d1a3045fa311bba4755d3aff8c5735e1baa2` |
| Proposed closures | None |
| Existing identity tests, rerun here | 160 pass, 0 fail, 14 files, Bun 1.4.0 |
| New audit probes | 2 pass: [capability-inventory-audit.test.ts](../../packages/dax/src/conformance/capability-inventory-audit.test.ts) |
| Frozen install | Passed; `bun.lock` SHA-256 `831bad44…e642de`, unchanged |
| Not run | Full `release:gates`, three-platform CI (no runtime change yet) |

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 6 |
| **Total** | 12 |

## Enrollment inventory

"Enrolled" means a production caller resolves a validated descriptor and rechecks
the bound executor before the effect. It never means authorized.

| Family | Production entry point | Capability ID | State |
| --- | --- | --- | --- |
| Native model tools | `session/prompt.ts:1297`, `tool/batch.ts:84`, queued task `session/prompt.ts:687`, `cli/cmd/debug/agent.ts:56` | `native.tool.<id>`, 22 ids at `capability/registry.ts:29` | Enrolled |
| Loader plugin tools | `tool/registry.ts:189` (directory and configured sources) | `plugin.tool.v1.p<sha256>` | Enrolled |
| Opt-in custom tools | `tool/registry.ts:505` `registerEnrolled` | `plugin.tool.v1.p<sha256>` | Enrolled; zero production callers |
| Legacy custom tools | `tool/registry.ts:492` `register` | none | Unenrolled by design; zero production callers |
| MCP tools | `session/prompt.ts:1400`, `mcp/tool-identity.ts:66` | `mcp.tool.v1.m<sha256>` | Enrolled |
| MCP resources | `mcp/index.ts:972` | `mcp.resource.v1.m<sha256>` | Enrolled |
| MCP prompts | `mcp/index.ts:925`, reached from `command/index.ts:146` | none | Unenrolled |
| Built-in graph operators | `execution/run-graph.ts:111`, `operators/router.ts:55` | `operator.<type>.<action>`, 9 ids | Enrolled |
| Custom graph operators | `operators/router.ts:53` | none | Unenrolled by design; zero production callers |
| Fixed workflows | `workflows/*.ts` execute and resume methods | `workflow.<class>.<phase>`, 6 ids | Enrolled |
| Generic workflow class | `execution/run-factory.ts:317` | none | No workflow capability; runs the session loop, so its effects are native tool calls |
| External workers | `workflows/worker-run.ts:94,124,339,386` | `worker.profile.<id>` | Enrolled; an unbound provider throws before checkout |
| Worker and native verification commands | `worker/worker-sandbox.ts:428`, `execution/native-verification.ts:12` | none | Unenrolled; DAX-owned, contract-supplied commands |
| Command-template shell | `session/prompt.ts:2706` | `session.command.shell` | Enrolled |
| Operator session shell | `session/prompt.ts:2349`, route `server/routes/session.ts:852` | none | Unenrolled |
| Prompt attachments | `session/prompt.ts:1716-1907` | `session.context.attachment.{stat,read,list,media}` | Enrolled |
| Template references | `session/prompt.ts:488` | `session.context.template.stat` | Enrolled |
| Plugin module load and hooks | `plugin/index.ts:91,117`, `tool/registry.ts:201` | none | Unenrolled; trusted in-process code, holds `Bun.$` |
| Config-driven processes | formatter `format/index.ts:113`, MCP stdio `mcp/index.ts:528`, LSP `lsp/index.ts:113` | none | Unenrolled |
| Operator direct actions | revert `session/revert.ts:59,85`, worktree routes `server/routes/experimental.ts:112-185`, PTY `pty/index.ts:149` | none | Unenrolled |
| Flowright invocation | `flowright/capability-service.ts:138` | `dax.<workflow>` (separate namespace) | Reaches an enrolled fixed workflow; its own names are not registry ids |

## Findings

### Authority boundary

| Issue | Location | Severity | Recommendation |
| --- | --- | --- | --- |
| Contract allowlist and permission class are keyed by alias, so a loader tool named `read` runs opaque effects inside a read-only contract | `execution/execution-contract.ts:150`, `tool/tool-class.ts:59`, `session/prompt.ts:1289,1329` | High | Workstream 2: resolve grants by capability ID, not alias |
| Operator session shell runs with no contract check, permission ask, or native invocation record | `session/prompt.ts:2349-2583` | High | Enroll now; decide its contract policy in workstream 2 |

Both are demonstrated by the probes, not inferred. The first needs a tool file in a
scanned config directory, which is trusted code by design; the defect is that the
reviewed contract and the `read` permission rule describe a different executor than
the one that runs. The second needs a caller of the local server API or TUI `!`.
Neither is a regression introduced by the enrollment slices.

### Vocabulary

| Issue | Location | Severity | Recommendation |
| --- | --- | --- | --- |
| No single registry: seven static instances plus per-entry dynamic ones, with no aggregate listing and no cross-family duplicate rejection | `capability/registry.ts:51`, `operators/capability-identity.ts:26`, `workflows/capability-identity.ts:18`, `worker/worker-adapter.ts:385`, `session/*-identity.ts`, `capability/dynamic-identity.ts:39`, `mcp/resource-identity.ts:33` | Medium | Compose one named registry; reject duplicates across families |
| Consequential entry points outside the vocabulary: session shell, MCP prompts, verification commands, config-driven processes | see inventory | Medium | Enroll each, or record it as an explicit declared exclusion with a test |
| Open-gap check probes `register(tool)`, an API with no production caller | `conformance/contract-capability.test.ts:60-97` | Medium | Replace with a production-population check once legacy policy is decided |
| Flowright exposes a second "capability" namespace with no mapping to registry ids | `flowright/capability-service.ts:18-33` | Low | Map each name to its `workflow.*` id explicitly |
| `list` and `todoread` tools are defined without descriptors; `list` executes in production through the attachment path | `tool/ls.ts:38`, `tool/todo.ts:36`, `session/prompt.ts:1874` | Low | Add descriptors or delete the dead definition |
| Implemented id shapes differ from the approved proposal | `docs/roadmap/CAPABILITY_REGISTRY_PROPOSAL.md:38-41` | Low | Record the implemented scheme as the reviewed one |

### Properties

| Issue | Location | Severity | Recommendation |
| --- | --- | --- | --- |
| `riskClass`, `scopeSupport` and `requiresVerification` have no production reader; no receipt or event carries a capability ID | `grep -rnE "\.riskClass\|\.scopeSupport\|\.requiresVerification" packages/dax/src` | Medium | Record the capability ID in receipts; consume properties in workstream 2 |
| Operative classification is a separate name-keyed list that can disagree with the descriptor | `tool/tool-class.ts:24-30`, `execution/native-settlement.ts:166` | Low | Derive it from descriptors for enrolled executors |
| Compiler default tool list names tools that do not exist (`bash`, `search`, `browser`, `todo`) | `execution/compiler.ts:20` | Low | Derive from the registry; check callers that omit `availableTools` |

The approved proposal says the registry "fails if it is just another unused
inventory". Identity binding is used and tested. The property fields are not.

### Records

| Issue | Location | Severity | Recommendation |
| --- | --- | --- | --- |
| Ledger text for both `inv5` entries described families that later slices enrolled | `conformance/known-gaps.ts:30-33` | Low | Reconciled on this branch |

Ownership text in `AGENTS.md:27`, `docs/DAX_STATUS.md:24-29` and
`docs/MULTI_AGENT_SOP.md` section 11 still says Claude has no lane. It is left
unchanged here for the maintainer to assign an editor.

## Open questions

These change authority semantics or compatibility, so they are escalated rather
than decided here.

- **Legacy unenrolled executors.** `ToolRegistry.register` and caller-supplied graph
  operators have no production caller. Options: reject them at dispatch, keep them
  as a declared exclusion outside the invariant, or require enrollment. Recommended:
  reject at production dispatch boundaries, keeping `registerEnrolled` as the
  supported path. The vocabulary gap cannot close while an unmapped executor can run.
- **Invariant population.** Whether operator direct actions (session shell, revert,
  worktree, PTY), config-driven processes, and plugin hooks are inside the
  "consequential execution entry point" population or declared outside it.
  Recommended: session shell and verification commands inside; plugin hooks and
  module load declared outside as trusted code; config-driven processes inside.
- **Alias shadowing.** Whether a loader tool may keep replacing a native alias in
  the offered table. Recommended: keep until grants resolve by capability ID, then
  require a distinct alias.

## Residual risk

- Project `.dax/tool/*.{js,ts}` appears to be imported at discovery
  (`config/config.ts:231-238`, `tool/registry.ts:193-201`) before any approval.
  Read from source only; not exercised by a run.
- `cli/cmd/*` commands that spawn `git` and `gh`, `installation/`, `snapshot/` and
  `worktree/` internals were classified by reading call sites, not traced.
- ACP and Soothsayer entry points were not traced past the session and run-gateway
  boundaries they call into.
- Hosted CI, Windows and Linux behavior: not run for this documentation and
  probe-only change.

## Next actions

1. Compose one named registry from the existing family registries, with
   cross-family duplicate rejection and an aggregate listing. Descriptive only.
2. Enroll the unenrolled entry points that need no policy decision: session shell,
   MCP prompts, verification commands, `list`.
3. Add a machine-checked inventory so a new spawn or dispatch site fails CI until
   it is classified.
4. After the three decisions above, replace the legacy-registration gap check with
   a production-population check and propose closure with rejection controls.
