# DAX 2.0.0 release candidate

Prepared 2026-10-07. **Not published.** v1.5.0, its assets and the installed binary
remain unchanged until a separately authorized release. This is a major version
because HTTP operator access, OAuth credential use and journal compatibility change.

## What ships

- Durable delegation, assistant, instruction, context and compaction provenance
  within the declared producer scope; replay does not invent historical coverage.
- Explicit compiled generic-run V2 grant review, exact approval/publication,
  activation/start, shared allow/ask/deny enforcement and narrower delegation.
- Shared scope-owned journals, protected project fact/settings review and approved
  memory/conventions consumed by later sessions.
- Home-screen identity, Explore response visibility and live activity separated
  from durable run completion.
- Authority identity, graph, verification, background-scan lifetime, dependency,
  OAuth issuer and checkout-local typecheck corrections.

The original sprint ledger is empty in the candidate's documented scope. This
is not an error-free claim, an independent security audit or support for every
executable binding form.

## Required migration

1. HTTP writes and terminal WebSocket control now require operator Basic credentials.
   Set `DAX_SERVER_PASSWORD` before starting an HTTP server; username defaults to
   `dax` and can be set with `DAX_SERVER_USERNAME`. With no password, HTTP is
   read-only. `--allow-unauthenticated` allows a listener, not privileged actions.
   The default private in-process TUI remains usable. Protect credentials and use
   an encrypted channel for remote access.
   Commands launched through model shell tools, operator shell, and command snippets
   omit DAX operator credentials, inline configuration/authenticated server URLs,
   and Infisical bootstrap variables, even when shell environment hooks supply them.
   Project/provider environment remains available. Shell profiles or arbitrary
   same-user code can still retrieve credentials outside this inheritance boundary.
2. Actor names are audit labels. Shared-secret access is not verified human identity
   and does not isolate arbitrary same-user code that can access those credentials.
3. Review project facts/settings through their protected candidate endpoint with
   the exact inspected digest. Generic run approve/deny cannot decide those gates.
4. Reauthenticate older issuerless MCP credentials. Files are preserved, but those
   credentials are not reused. Pre-registered clients need `oauth.expectedIssuer`
   from trusted authorization-server configuration; do not infer it from MCP
   discovery. Add/debug commands now carry it, and status no longer mislabels
   issuerless credentials as authenticated.
5. Preserve state/backups before upgrading. Never open newly written journals with
   v1.5.0. Existing V1 history is not silently rewritten or granted V2 authority.

## Supported boundary and deferred work

Reviewed execution supports a known compiled image and explicitly acknowledged
remote MCP. Plugin/local-MCP/worker/verifier executable bindings remain unsupported
and blocked in reviewed runs; their legacy compatibility paths remain explicit.
Trusted plugin loading/hooks and service initialization are outside arbitrary-code
containment. Digests cannot reconstruct transcripts or prove provider receipt.
Only specific OS interruption boundaries have been tested. Docker-dependent checks
remain unavailable without a daemon. Build-host Rust sidecars do not establish
cross-compiled sidecar coverage for every target archive.

## Validation and publication

The pre-release runtime corrections require exact-SHA code review and all-platform
CI, in addition to full gates and packaging/installer checks. See
[the final corrective validation record](../tooling/release-2.0.0-final-checkpoint.md).

The maintainer integrates the final candidate, requires post-integration CI, then
publishes the matching version tag only after verifying its assets. Installer
validation uses disposable destinations; it never replaces the operator's binary.
Merged branch cleanup follows published-main ancestry checks and preserves dirty
or unrelated worktrees and needed ignored evidence/dependencies.
