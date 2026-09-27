# MCP tool identity — candidate validation

Owner: Sol. Tier 2 independent reviewer: Astra, pending availability.
Branch: `feat/mcp-capability-identity`; dependency/base plugin checkpoint:
`051c1752ae7842c6bb99ed1e121c13832ab6449f`. Published main remains at
`d2ef0b0f510c70df29d3855f399e02902fbe4014`. The maintainer authorized continued
bounded implementation while Astra is away and chose **feature branches for review**.
This is solo implementation evidence, not independent validation, integration or
gap closure. Published v1.5.0, release assets and installed binary stay unchanged.

## Production and authority boundary

The [approved architecture](../roadmap/PLUGIN_MCP_CAPABILITY_PROPOSAL.md) enrolls
only DAX-produced MCP **tool adapters**, alongside the earlier plugin delivery.
Opaque `mcp.tool.v1.m<digest>` IDs name the raw configured server key and protocol
tool name with versioned length-delimited encoding. Private bindings capture the
actual client receiver, call method, full tool metadata, effective timeout and
instance generation. DAX-owned `high`/`opaque`/verification-required descriptors
grant no permission and imply no confinement.

Discovery validates the whole table before publication. Raw duplicates, sanitized
aliases and cross-family collisions reject rather than overwrite. Malformed or
ambiguous changed catalogs invalidate their sources, not healthy siblings.
Unchanged rediscovery preserves bindings. Changes, notifications, replacement,
disconnect, unexpected close and disposal invalidate affected bindings; pending
connection creation cannot install into disposed or newer source state.

SDK listTools also updates cached output validators/task requirements. Superseded
requests are cancelled before this side effect; operator catalog/inspect/ping reads
share discovery ordering. Older results cannot restore bindings or disable a newer
healthy client. Ordinary list failures retain failed-status/omission semantics
while healthy siblings remain available. Identity errors never retarget or retry.

Session wrapping does not mutate the bound adapter. Identity resolves before
hooks/authorization and is rechecked by the captured executor after awaited
approval/hooks. Direct genuine adapter calls share its first-effect guard.
Already-started effects keep their original outcome; invalidation neither rolls
them back nor proves external cancellation.

Existing v1/no-contract allow/block behavior, asks/denials, governing-run scope,
sandbox, SDK parsing, translated DAX result validation, truncation, settlement and
completion remain. MCP batching remains unsupported. No event vocabulary, grant
enforcement, public plugin manifest or custom register(tool) enrollment is added.
All **eight aggregate gaps remain open**; 11/11 scoped record classes and inv1
closure are unchanged. Operator/workflow and worker/context delivery remain separate.

## Evidence and reproducibility

Use checksum-verified [Bun 1.4.0](bun-toolchain-verification.md), explicitly selected
at `/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`.
Put its directory first on PATH for child scripts. Use fresh DAX/XDG test homes,
CI's 4 GiB Node heap and frozen installation; do not replace the lockfile or global
runtime. Focused tests use explicit ./packages paths to avoid discovering exported
controls under ignored artifacts. Full release:gates runs in non-release mode.
The pushed SHA, exact-SHA CI and final counts are pinned in the handoff, not inferred
from an earlier draft. Raw logs are preserved under the handoff's absolute
artifacts/validation/mcp-capability-identity directory, outside test discovery.

The MCP suite uses real SDK loopback HTTP servers/clients and a real stdio process,
not a mocked MCP.tools. Real SessionPrompt, Plugin hooks, Permission approval/denial,
contract filtering and result translation run with only the model boundary
controlled. Controls cover strict identity, raw names, copied/changed adapters,
schema/method changes, notification/disconnect/replacement, discovery and creation
races, the SDK validator race, source/instance isolation, disposal during creation,
in-flight effects, stable collision reporting and result validation. The handoff
also includes plugin/native, dynamic identity, contract capability, governing-run
and strict File lifecycle regressions.

Four selected probes against exported unchanged 051c175 fail as intended:
raw-name collisions and invalidation before dispatch, during approval and during
a hook. Only the fixture is copied; its unused new identity-helper import is
removed for baseline module compatibility. No baseline MCP/dispatch code is
replaced. The operator check uses an isolated profile and controlled servers,
with actual terminal captures, not an API-created session or unit test.

## Retained failures and limits

- sdk-validator-race-negative.log refutes the earlier draft guarding only DAX
  publication: the SDK still accepted the older output validator. Superseded
  request cancellation and shared operator discovery correct it.
- focused-sdk-ordered.log exposed a test-server shutdown issue: SDK JSON-response
  mode leaves cancelled POST response promises unresolved on close. The streaming
  HTTP fixture returns SSE responses immediately and closes streams during strict
  disposal. No retries, skips or swallowed cleanup errors were added. A subsequent
  fixture failed during the timed-out hook; that contaminated result does not
  establish a production git/bootstrap defect.
- The first stdio fixture used an executable configuration in an untrusted project;
  existing trust filtering withheld it. The corrected synthetic fixture uses its
  isolated trusted global configuration, not a weakened production trust check.
  A following attempt caught double-conversion of Bun's already-resolved file URL;
  fixture imports now preserve that URL and reset the global config cache between
  isolated homes, without changing production caching or trust behavior.
- Initial typecheck caught overly narrow inferred adapter-table types; the public
  Record<string, Tool> contract is preserved. Initial lint caught test receiver
  aliasing and declaration style. Those checks were not weakened.
- First committed candidate c07b972 passed 124 focused tests (625 assertions),
  but release-gates-c07b972.log stopped at one obsolete MCP floating-promise
  suppression. The notification handler now awaits Bus.publish. ESLint's prune
  command removes only that unused count (2 to 1), with no active suppression
  added and no rule disabled. lint-prune.log records an initial incorrect relative
  command path; lint-prune-corrected.log is the successful package-root command.

The actual 80x24 PTY submission typed "Check the synthetic MCP collision." and
sent Enter on the separate input action. Two real stdio protocol names normalize
to one alias. The existing toast rendered "Capability identity rejected: ambiguous";
the controlled loopback provider counted zero calls, also after --continue reopen.
Raw operator-tui.ansi, operator-reopen.ansi and operator-provider.ansi are retained.
operator-rendered.txt is an approximate frame extracted from the real capture,
not a native screenshot or mockup. The existing HTTP error console can clutter the
terminal; general error/status presentation is not changed by this slice.

IDs are logical source identity, not code/remote attestation, encryption or receipt.
No new arguments/results/credentials/endpoints are retained for identity. Private
source metadata is not journal/public descriptor content; the existing operator
catalog retains its existing server/name fields, not a new provenance API.
Arbitrary trusted code calling its own SDK client, plugin initialization/hooks,
MCP launch/auth/prompt/resource reads, legacy custom registration and other executor
families remain excluded. Remote changes without notification/discovery cannot be
attested. Historical receipts cannot acquire identity from today's catalog.
Provider-adapter commitments do not prove receipt; digests cannot reconstruct
transcripts; historical coverage is unknown; OS-kill recovery is untested.
Running/Brooding and earlier intermittent failures remain separate followups.
