# Plugin/MCP tool capability identity — proposal only

Owner: Sol. Architecture/Tier 2 reviewer: Astra. Recorded 2026-09-27.
Inspected published baseline: `d2ef0b0f510c70df29d3855f399e02902fbe4014`.
[Post-integration CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36293195364)
is green on Ubuntu, macOS, and Windows. Native enrollment is integrated; this
document proposes the next bounded adapter slice, not runtime implementation.
Published v1.5.0 remains unchanged; scoped provenance coverage is 11/11 and all
eight aggregate gaps, including vocabulary/properties, remain open.

## Recommended scope and observed behavior

Enroll loader-backed plugin **tool exports** and MCP **tool calls** in the existing
strict descriptive registry. Bind each enrolled identity to its actual executor,
not a model-visible name. This advances adapter coverage without adding grants or
changing the contract schema. Treat these as opaque operations with conservative
DAX-owned properties: `riskClass: high`, `scopeSupport: opaque`,
`requiresVerification: true`. These are descriptions, not newly enforced approval
or verification policies and not proof that opaque internals are confined.

The inspected production paths are:

| Entry point (under `packages/dax/src`) | Current boundary and missing identity |
| --- | --- |
| `plugin/index.ts` → `tool/registry.ts:state/fromPlugin` | Configured modules return hook objects; module/initializer attribution is discarded. Directory tools retain only a basename/export-derived alias. The registry captures its adapter wrapper, but that wrapper reads `def.execute` again at invocation time. |
| `tool/registry.ts:register` | Public custom registration replaces the same alias and supplies no source. Its current callers in this tree are tests/conformance fixtures. This legacy API cannot be relabeled as loader-backed enrollment without explicit metadata. |
| `session/prompt.ts:resolveTools`, `tool/batch.ts`, `cli/cmd/debug/agent.ts` | Plugin tools use the genuine initialized registry wrapper. Existing contract filtering, permission/authorization, result validation and settlement remain. Batch supports registry plugins, not MCP. Debug selects the first matching alias, whereas prompt/batch use their current map selection; identity must describe the actually selected executor, not invent equivalent routing. |
| `mcp/index.ts:tools/convertMcpTool` → `session/prompt.ts:resolveTools` | Raw server/tool names are sanitized and concatenated into model aliases; collisions can overwrite entries. The adapter reads `client.callTool` and tool name at call time. The session layer mutates its returned tool in place to add hooks/schema transformation. MCP has no private capability binding today. |

Preserve `Plugin.list()`'s hook-only API for auth/provider callers. Add an internal
origin-aware tool view/sidecar, rather than requiring a new public plugin manifest.
No plugin-auth API or public `@dax-ai/plugin` interface change is planned.

Excluded: plugin installation, module top-level/initialization/config/event/auth
hooks; MCP process launch, connections/OAuth, prompt/resource reads; workflows,
operators, workers, command/context adapters; grants, shared enforcement, event
vocabulary, journals and memory. Loading a trusted in-process plugin can already
execute arbitrary code. Enrollment of its tool export cannot authorize, sandbox
or contain those earlier or internal effects. This is not universal MCP or plugin
execution coverage. It does not repair debug's existing authority limitations.

## Identity and catalog design

Carry a typed private source tuple alongside discovery **before** flattening:

- Directory tool: origin kind, normalized absolute module locator, export key.
- Configured plugin tool: origin kind, configured locator and resolved module
  locator, actual initializer export identity, tool export key. Capture these at
  loading; do not reconstruct them from aliases or reread source for attribution.
  Default/named aliases of the same initializer remain initialized once as today;
  choose a deterministic canonical export key from that function's alias set for
  metadata only, without changing initialization ordering.
- Internal plugin tool, if any: explicit DAX-owned source key plus tool key.
- MCP tool: origin kind, raw configured server key and raw protocol tool name.
  A private binding also captures the actual connected client and call method.

Derive opaque IDs as `plugin.tool.v1.p<sha256>` / `mcp.tool.v1.m<sha256>` over a
versioned, length-delimited UTF-8 tuple encoding (no lossy sanitization or ambiguous
string concatenation). Retain the full tuple privately to detect a digest collision;
two different tuples with one digest are rejected, never merged. Reject malformed
tuple fields (including unpaired UTF-16 surrogates rather than lossily replacing
them during UTF-8 encoding) and duplicates before publishing the whole candidate catalog.
The existing descriptor schema and immutable registry remain the only descriptor
validator; source claims or server annotations cannot supply authority fields.

An ID names a DAX adapter's logical source, not a code digest, portable package
attestation, authenticated remote implementation or server receipt. Changed
locators can change IDs; the same MCP key across projects is not global authority
equivalence. Future grants must bind the governing contract/project scope as well.

Keep capability ID separate from legacy model/permission/receipt aliases. Resolve
private bindings on actual initialized objects; names alone cannot enroll tools
or turn a plugin called `read` into `native.tool.read`. Capture the original
definition execute function and receiver inside `fromPlugin`; capture SDK
`callTool`, its client receiver and raw tool name inside the MCP adapter.
The session wrapper must not mutate the catalog's bound execute reference; create
a wrapper around the resolved immutable identity instead.

Proposed ambiguity rule (architecture decision): preserve the already-supported
native/plugin override and current selection order, while rejecting duplicate
plugin aliases from distinct loader sources, duplicate raw MCP names, sanitized
MCP alias collisions, and MCP aliases colliding with another offered tool family.
Reject the candidate offered-tool table before model dispatch/hooks/effects;
do not silently overwrite or rename entries. Same-alias programmatic registration
continues its legacy replacement behavior, explicitly unenrolled, and cannot
steal an enrolled descriptor. This introduces fail-closed behavior for ambiguous
dynamic catalogs; that compatibility change needs Astra's approval.

Programmatic `register(tool)` remains usable and visibly unenrolled. A narrow,
optional typed source argument can opt a custom registration into enrollment,
using a distinct `registered_custom` origin kind and caller-supplied source key.
That key is declared provenance, not verified module attribution; it cannot impersonate
loader, MCP or native origin metadata. Binding its genuine initializer/executor
works just like loader-backed entries; it
cannot accept arbitrary descriptor/permission claims. This is the smallest
internal interface extension for origins unavailable today, not a blanket registry
requirement that disables all historical custom tools. Unenrolled paths remain
an explicit coverage obligation, not a fallback for an invalid enrolled record.

## Lookup, invalidation and failures

Resolve enrolled identity before tool execution hooks or effects through real
SessionPrompt plugin/MCP dispatch, batch plugin leaves and the debug handler.
Require the same identity at the adapter's direct first-effect boundary so calling
the DAX-produced MCP tool directly cannot bypass binding validation. Direct calls
made by arbitrary trusted code to its own SDK client are outside this boundary;
we do not claim containment of that code.

Each binding captures a private generation token. Replacing a registration,
disconnecting/replacing a client, or a tools-changed notification invalidates old
prepared bindings; a successful changed catalog gets a new generation atomically.
Repeated enumeration of an unchanged catalog must not invalidate active healthy
turns. Recheck currency immediately before calling the captured effect after any
awaited hook/approval; reject stale identity rather than dispatch to a replacement.
No lock is held across hooks, approvals, provider calls or MCP transport.

Malformed/ambiguous candidate catalogs never publish a partial new snapshot. A
previous snapshot may remain only if its client/source generation is still valid;
a known changed or disconnected source cannot be served from stale cache. Keep
existing connection/list failures distinct from identity-validation failures.
Use stable identity error codes without source paths, arguments or arbitrary
exception text. Reject unknown, forged, changed or stale enrolled bindings with
zero tool-body/transport calls. No downgrade to legacy enrollment, alias fallback,
automatic retargeting or execution retry after identity rejection. Existing
settlement error handling records an ordinary failed tool attempt where applicable;
identity is not permission and adds no success receipt. An effect already underway
retains its original captured binding and existing outcome/uncertainty semantics;
invalidation does not claim that an external effect was cancelled or roll it back.

Preserve non-blocking normal dispatch and instance isolation. Add generation
tracking only at registry/MCP owners, not a new global lifecycle framework.

## Authority, history and retention

Existing v1 contracts and no-contract paths keep their current tool aliases,
allow/block behavior, asks, sandbox, governing-run scope, protected-path checks,
mutation observation, result validation, verification and completion semantics.
No automatic allowlist expansion, default grants, contract migration or legacy
successor-run policy is authorized. Capability lookup precedes current approvals
but never replaces them. Low risk or a false verification property cannot weaken
them; conservative opaque properties do not confer confinement or a verification
receipt. External MCP read-only/destructive hints remain untrusted annotations.

Historical journal replay continues to use stored contracts/receipts under their
original semantics. This slice adds no event types or retrospective capability
IDs to old receipts. Today's discovery cannot prove historical executor identity
or convert unknown history into coverage. A later grant/receipt slice must separately
specify durable source references and migration; this catalog alone does not prove
restart/replay of exact plugin code or remote server behavior.

Retain descriptors and opaque IDs, not new raw invocation content. Source tuples,
module locations, export metadata and client-generation bindings remain internal
instance data; do not add them to model-visible descriptions, journals or public
diagnostics. Do not retain arguments, results, credentials, MCP endpoints or env
values for identity construction. A deterministic hash is neither encryption nor
a secrecy guarantee; it must not be sold as protecting a low-entropy locator.
Existing prompt/context/result commitments and redaction behavior are unchanged.
Provider-adapter commitments still do not prove receipt; digests cannot reconstruct
transcripts; historical coverage remains unknown; OS-kill recovery is untested.

## Proposed files, dependencies and acceptance

Dependencies: integrated strict descriptor/registry and native executor binding;
existing plugin discovery and MCP owners; current Tool/SDK result validation and
contract/permission wrappers. No grant or compaction dependency.

Likely runtime files: new `capability/dynamic-identity.ts`; narrow changes in
`plugin/index.ts`, `tool/registry.ts`, `mcp/index.ts`, and MCP wrapping in
`session/prompt.ts`. Batch/debug should need no new authority logic because they
already use registry identity, but their real entry points must be exercised.
Test files: `capability/dynamic-identity.test.ts`,
`capability/plugin-dispatch.test.ts`, `mcp/capability-dispatch.test.ts`, and narrow
regressions in `conformance/contract-capability.test.ts` plus existing native,
batch, governing-run and output-validation suites as needed.

Behavioral acceptance and negative controls:

1. Real directory and configured plugin loaders preserve source metadata into
   dispatch; named/default initializer aliases initialize once. Native-name
   plugins stay plugins. Real SessionPrompt dispatch, batch leaves and debug
   execute the actually selected captured function with its original receiver.
   Use synthetic modules, not user configuration or private journals.
2. Real MCP SDK server/client fixture performs discovery and `callTool` through
   production conversion and session wrapping (controlled external boundary,
   not a mocked `MCP.tools()`). Raw names survive model aliasing; protocol and
   translated result validation/truncation remain intact. MCP batching remains
   disallowed as today.
3. Unknown/forged bindings, descriptor malformation/authority fields, duplicate
   tuples and ambiguous aliases reject with counters proving zero hooks/body/
   transport calls where preflight applies. Test delimiter/Unicode punctuation
   identity distinctions and sanitized collisions, not just catalog filenames.
4. Mutating a definition, returned adapter, tool name or SDK method before lookup
   cannot redirect execution. Mutation during a hook cannot replace the captured
   function/receiver. Replacement/disconnect/catalog change during an await rejects
   a stale token; no automatic execution through its successor. Unchanged repeated
   discovery and parallel healthy sessions do not falsely invalidate bindings.
5. Failed catalog refresh publishes no partial catalog; disconnected sources
   cannot execute from an old snapshot. Direct DAX MCP adapter invocation and
   plugin adapter invocation retain the same identity check. Different instances
   with identical aliases never share executable bindings.
6. Contract-blocked plugin/MCP requests, parent-governed child denials, existing
   asks and no-contract permission behavior remain unchanged. Descriptor or remote
   annotation mutation cannot authorize a denied action. Existing provenance,
   compaction and completion negative controls remain passing.
7. Replay historical v1 contracts/receipts without loading today's catalog as
   authority. Legacy unmarked custom registration stays usable but unenrolled;
   explicit invalid enrollment fails closed instead of reverting to that path.
8. Replace coverage checks for enrolled adapters with normal passing production
   regressions; retain meaningful failing controls on real unenrolled paths.
   Vocabulary/properties stay open because operators/workflows/workers/context
   and legacy custom paths are not covered. All eight gaps remain open.

Implementation handoff requires exact pushed SHA, pinned Bun **1.4.0** focused
tests and full `release:gates`, retained failed and successful controls outside
test discovery, and green exact-SHA Ubuntu/macOS/Windows CI. If the proposed
ambiguity errors change operator-visible behavior, include an isolated controlled
TUI tool submission/error/reopen smoke; unit/API fixtures are not interactive
acceptance. Astra independently reviews the Tier 2 diff before any integration.
No release, binary replacement, UI polish or unrelated Running-label/test-flake
investigation is included.

Decision requested: approve/refute this bounded tool-only enrollment, source-sidecar
and optional registration metadata, conservative opaque properties, ambiguity
compatibility rule and binding invalidation semantics before implementation.
