# DAX 2.0.1 patch release

Published 2026-10-08 at [v2.0.1](https://github.com/ShaileshRawat1403/dax/releases/tag/v2.0.1),
source **fe911e57415dcfa9d101bd2584b28d2ea3c84694**. The local installation now
reports 2.0.1. [Publication and install evidence](../tooling/evidence/release-2.0.1/published/README.md)
records verified assets, packaged diagnostics and DAX-only cleanup.
2.0.0 and earlier tags/assets remain immutable.

## Changes and migration

- Native Claude chat is API-key-only. The patch removes subscription-OAuth login,
  token refresh, Claude Code identity rewriting and an unused duplicate adapter.
  Existing token files remain intact but are not used or refreshed for native
  inference. `dax doctor auth anthropic` identifies the retired lane.
- Configure an Anthropic API key with `dax auth login anthropic` or
  `ANTHROPIC_API_KEY`. Old API-key configurations using `claude-code` remain usable.
  The official Claude Code worker keeps its own CLI authentication; it is a
  separate execution path, not promised subscription entitlement for native DAX
  chat. [Current Anthropic policy](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
  applies to subscription and usage-credit access.
- Windows native-ledger lock acquisition handles bounded access-denied/sharing
  contention only during atomic lock creation. It neither steals an existing
  lock nor turns persistent denial into success. Ledger data IO errors remain
  errors. The original intermittent AccessDenied operation/handle is unidentified.

## Validation and retained limits

[Authentication source evidence](../tooling/evidence/claude-oauth-retirement/README.md)
and [ledger evidence](../tooling/evidence/windows-ledger-contention/README.md)
pin prior reviewed sources, passing platform controls and failed attempts. Final
2.0.1 source and post-integration CI passed all three platforms; tagged-mode
gates, build/publication, all eleven archive checksums and public install passed.
The earlier Windows compiled-probe fixture EBUSY handle remains unidentified;
subsequent passing CI does not establish its cause. No AGY latency fix is claimed.

The original scoped conformance ledger remains empty. Unsupported reviewed
plugin/local-MCP/worker/verifier bindings remain denied, Rust helpers remain
build-host-only, and historical unknown coverage stays unknown. This patch
retains [2.0.0 migration requirements](release-2.0.0.md), including operator HTTP
credentials, MCP issuer reauthentication and no v1.5.0 journal downgrade.
