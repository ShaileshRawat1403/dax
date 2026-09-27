# Loader-backed plugin tool identity — candidate validation

Owner: Sol. Tier 2 reviewer: Astra. Recorded 2026-09-27.
Branch: `feat/plugin-capability-identity`; published base
`d2ef0b0f510c70df29d3855f399e02902fbe4014`. The approved proposal and binding
decision are preserved in [the plugin/MCP proposal](../roadmap/PLUGIN_MCP_CAPABILITY_PROPOSAL.md).
The exact pushed SHA and three-platform CI are pinned in the review handoff.
This document is implementation evidence, not review acceptance or integration.

## Delivery and authority boundary

This substantial delivery implements **plugin tools only**. MCP enrollment is
deferred until Astra reviews it. The narrow MCP change rejects a foreign alias
overlaying an already offered native, loader or legacy tool; its fixture controls
the foreign table and does not claim controlled-transport MCP identity proof.

Real directory/configured loaders carry source tuples before alias flattening.
Opaque, versioned, length-delimited IDs bind the loaded definition, receiver,
execute function, source ownership and typed validation metadata. Unchanged
rediscovery preserves healthy generations. Source/object/function/schema changes,
removal on rediscovery, instance disposal and legacy replacement invalidate affected
bindings. Older overlapping discovery cannot overwrite newer state. Catalog
publication is atomic; ambiguous tables never publish partially.

Identity is checked before hooks and again immediately before effects after
awaited hooks/approval. Initialized input/result schema fingerprints are checked
as well as field references. No rejected binding dispatches through a successor
or automatically retries its effect. Native/plugin selection order remains as
before; a plugin called `read` never acquires `native.tool.read`.

Descriptors remain descriptive (`high`, `opaque`, verification required), never
permission grants or proof of confinement. Existing v1/no-contract checks,
allow/block rules, approvals, sandbox, scope, verification, canonical results and
completion semantics remain. `register(tool)` is unchanged and explicitly
unenrolled, even if its alias matches a native capability. Debug's pre-existing
authority limitations are unchanged; registry identity does not repair them.
All eight aggregate gaps remain open; scoped record-class coverage stays 11/11.

Private source tuples are instance data, not public fields, journal content or
new model descriptions. Stable rejection messages use the existing UnknownError
envelope, not a new event/error vocabulary. Deterministic IDs are neither
encryption nor code attestation. Historical contracts/receipts replay unchanged;
today's catalog cannot establish historical executor identity.

## Production evidence

- Focused command uses explicit `./packages/...` file paths for
  `capability/dynamic-identity.test.ts`, `capability/plugin-dispatch.test.ts`,
  `capability/native-dispatch.test.ts`, and `conformance/contract-capability.test.ts`.
  Final counts and full-gate results are supplied in the pinned handoff.
- Real directory and configured plugin imports; named/default initializer aliases
  initialize once. Genuine SessionPrompt, batch leaf and debug handler dispatch
  preserve original receivers and canonical string-result handling. Only the model
  boundary is controlled in session dispatch; debug bootstrap is not mocked.
- Real Permission approval and denial; mutations before hooks, during a hook and
  during awaited approval; initialized authorization/schema/description mutation;
  changed refinements with equal JSON schema; in-place initialized schema mutation;
  forged/copy objects; hook-source replacement; duplicate/legacy aliases; unchanged
  and changed overlapping discovery; disposal and unrelated-instance isolation.
- Four controls against an exported `d2ef0b0` runtime fail as intended: directory
  enrollment, configured enrollment and mutation at pre-dispatch/pre-hook phases.
  Only the probe test and error-class helper are copied into that export; baseline
  loader/registry/dispatch source is not replaced. Shared dependencies are reused.

Pinned binary:
`/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`.
Version check is 1.4.0; frozen install reports no changes. Lockfile/manifests remain
unchanged. Final gates use that binary first on PATH, CI's 4 GiB Node heap, and
fresh task-local DAX/XDG directories. Logs live outside package test discovery.
No tagged release, release assets or installed binary changes are made.

## Operator check

An actual 80x24 PTY TUI, launched with Bun 1.4.0 and `--conditions=browser`, uses
a synthetic isolated profile containing two real loader sources with one alias.
A greeting/control is typed and submitted interactively, not through an API-created
session. The existing error toast displays **Capability identity rejected: ambiguous**.
An owned loopback provider counter records zero calls. Exiting and `--continue`
reopening does not automatically execute the rejected request. Raw ANSI captures
and an extracted terminal frame are retained; the extraction is not a native
desktop screenshot or a design mockup. No maintainer credentials/journals are used.

The existing HTTP stream also prints its rejected exception to the terminal console;
the stable toast is now emitted via the existing session-error event at both
canonical birth and offered-table discovery. General streaming-error/log presentation
is not refactored in this slice. An early catalog error may precede a canonical
run/user-message append; the toast is not a new durable failure receipt.

## Retained failures and limits

Raw logs are retained under the handoff's absolute artifact directory:

- Initial fixture failures: missing SDK abort signal, invalid compiler arguments,
  incomplete controlled MCP schema, and a deliberately inconsistent source/ID
  fixture. Corrected fixtures keep the real producer and assertions.
- `lint-initial.log` used the wrong workspace for existing suppression paths;
  package lint uses the normal script. `lint-package.log` caught Bun matcher
  typing/await issues; the corrected rejection helper asserts outside its catch.
- `baseline-wrong-working-directory.log` ran candidate source and is void as a
  baseline control. `baseline-negative-controls.log` is the actual exported-base run.
- `focused-notification.log` used path filters without `./`, accidentally discovering
  both live and exported test copies. Its mixed-module failures are void. Explicit
  files and the normal package-confined full suite avoid this discovery error.
- `focused-explicit-files.log` and `release-gates-notification.log` caught missing
  notification at canonical birth: discovery occurred before the later resolveTools
  catch. The corrected two-boundary notification still rethrows; it never returns
  processor success or enters a provider retry.
- `initialized-schema-negative.log` demonstrates the pre-hardening in-place schema
  mutation escape. Typed initialized-schema checks close it; earlier green gate
  logs predate that hardening and are not final-source evidence.

First published candidate `44721844080982b7b81e5f6516372c8c96ee31a0` passed
local gates (1,939 passed, 2 skipped) but [CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36319906145)
failed Ubuntu's global-home root-EACCES cache fixture; macOS/Windows were cancelled
by matrix fail-fast. Logs are `ci-4472184-ubuntu.log` and `ci-4472184-failed.log`.
The fixture exhausted 100 setImmediate ticks in 2.17 ms before initial cache
publication. A controlled 25 ms root read reproduces the same assertion on the
published `d2ef0b0` File runtime (`baseline-home-delay.log`); this demonstrates the
fixture's timing assumption, not an identified runner/OS root cause.
The separate test correction snapshots actual directory entries before controlled
error assertions, preserves all failure/cache/cleanup assertions, and adds a
barrier-based pending-I/O/nonblocking/publication control. It changes no File
runtime, increases no retries, and skips no tests. Focused combined validation is
76 passed, 0 failed, 446 assertions; final combined gates/CI are pinned in handoff.

Trusted plugin module initialization/hooks/internal effects remain excluded. Bun's
module cache is not a hot-code-reload/byte-attestation mechanism: equality concerns
the actually loaded executor, not newly edited on-disk code. Source removal is
observed on rediscovery; callable/ownership/schema changes are rechecked at effects.
Closures and arbitrary trusted code are not sandboxed or attested. No MCP transport,
workflow/operator/worker/context or caller-declared custom enrollment is claimed.
Provider-adapter commitments do not prove receipt; digests cannot reconstruct
transcripts; historical coverage is unknown; OS process-kill recovery is untested.
Intermittent relay failures and the Running/Brooding observation remain separate.
