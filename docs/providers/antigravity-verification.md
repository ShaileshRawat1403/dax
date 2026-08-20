---
title: Antigravity Provider Verification
archetype: provider-verification
status: verified
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - providers
  - antigravity
  - verification
last_reviewed: 2026-08-20
---

# Antigravity Provider Verification

## Verdict

The Task B Phase 1 premise is **CONFIRMED**, and the Antigravity CLI (`agy`) is a viable replacement path for the `gemini` provider on this machine.

| Gate | Result |
| --- | --- |
| `gemini` OAuth dead on this machine | Confirmed — `IneligibleTierError`, `reasonCode: UNSUPPORTED_CLIENT`, `tierId: free-tier`, "Gemini Code Assist for individuals", "migrate to the Antigravity suite of products" |
| `agy` executes a real prompt | Confirmed — `AGY_OK` in real HOME, `AUTHOK`/`TOKENCOPY_OK` in isolated temp HOMEs, all exit 0 |
| Headless execution without interactive auth | Confirmed — copy of the token file alone authenticates a fresh HOME |
| State isolation achievable (auth vs runtime vs workspace) | Confirmed — see Findings |
| Egress observable and controllable | Confirmed — hosts logged; `HTTPS_PROXY`/`NO_PROXY` honored |

Evidence files: `docs/providers/evidence/` (probe outputs, installer, manifest, CLI-log excerpts, state diffs, proxy tests).

## Findings

### 1. Premise: `gemini` OAuth is dead on this machine (CONFIRMED)

- OAuth-only probe (creds unset, real `~/.gemini`): exit 1, `IneligibleTierError` with `reasonCode: 'UNSUPPORTED_CLIENT'`, `tierId 'free-tier'`, "Gemini Code Assist for individuals", redirect to https://antigravity.google.
- Probe with `GEMINI_API_KEY` restored (same real HOME): identical `IneligibleTierError` — the active OAuth account in `~/.gemini/google_accounts.json` (`shailesh.rawat1403@gmail.com`) routes `gemini` to the dead user path regardless of the API key.
- Fresh temp HOME + `GEMINI_API_KEY` + `--skip-trust`: `APIKEY_OK`, exit 0 — the API-key lane still works only when no OAuth account is present.

Evidence: `probe-oauth.stderr.txt`, `probe-apikey.stderr.txt`, `probe-apikey-freshhome2.stdout.txt`.

### 2. `agy` binary viability (CONFIRMED)

- Installer downloaded to `docs/providers/evidence/agy-install.sh`, sha256 `ee1ea43ce4e9e56356c4ab6dad907ef357ae4bdfcaadb682735909fb57c9c640`; supports isolated prefix via `--dir`.
- Manifest `darwin_arm64`: version `1.1.16`; payload `https://storage.googleapis.com/antigravity-public/antigravity-cli/1.1.16-6607970839166976/darwin-arm/cli_mac_arm64.tar.gz`.
- Installed binary reports `1.1.16`. `agy --help` includes `-p/--print`, `--print-timeout`, `--model`, `--mode accept-edits|plan`, `--sandbox`, `--dangerously-skip-permissions`, `--output-format text|json|stream-json`, `--continue/-c`, `--conversation`, `--project`, `--new-project`; subcommands `models`, `agents`, `install`, `mcp`, `plugin`, `changelog`, `update`.
- `agy models` exit 0: `gemini-3.7-flash-high`, `gemini-3.6-flash-*`, `gemini-3.5-flash-*`, `gemini-3.1-pro-high/low`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`. `agy agents` output empty.

### 3. Authentication model (CONFIRMED, sandbox-relevant)

- Token storage is **composite**: keychain first (`composite_token_storage.go` "Keyring SaveToken timed out after 5s, falling back to file storage"), then a token file.
- Token file: `~/.gemini/antigravity-cli/antigravity-oauth-token`, mode `0600`, JSON `{token:{access_token, token_type, refresh_token, expiry}, auth_method}` (`auth_method=consumer`, expiry 1h). Schema only, values redacted: `agy-token-file-schema.txt`.
- **Isolation proof**: fresh empty HOME + copy of only that one file → `TOKENCOPY_OK`, exit 0 (headless, non-TTY stdin). Auth material is a single file a governed worker can be provisioned with.
- Silent auth: CLI log shows "Print mode: not authenticated, trying silent auth" → `keyringAuth: loaded token ... expired=false` → `ChainedAuth: authenticated via keyring` → "silent auth succeeded".
- Interactive flow (no token): prints OAuth URL to `accounts.google.com` (client `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`, redirect `https://antigravity.google/oauth-callback`) and waits for a pasted code on stdin. **Requires a TTY**: non-TTY stdin fails fast with "authentication required. Run 'agy' to log in" / "authentication failed or timed out".
- Real HOME authenticates via the macOS keychain item `svce=gemini`, `acct=antigravity` (created 2026-05-23 by the Antigravity app; mdat updated 09:50 today); no token file exists in the real HOME.

Evidence: `agy-keychain-item.txt`, `agy-token-file-schema.txt`, `agy-tokencopy-test.txt`, `agy-run-log-excerpts.txt`.

### 4. State separation (CONFIRMED)

Writes observed in a fresh HOME across authenticated runs — all under `~/.gemini`:

- **Auth material** (read-only, must be provisioned): `.gemini/antigravity-cli/antigravity-oauth-token` (or the shared keychain item for the operator's own login).
- **Mutable runtime state** (writable, ephemeral): `.gemini/antigravity-cli/{brain,conversations,conversation_summaries.db,cache,log,presence,updater,crashes,installation_id,last_check.timestamp,jetski_state.pbtxt,knowledge,builtin,scratch,bin}` and `.gemini/config/{config.json,mcp_config.json}`.
- **Workspace/project state**: `.gemini/config/projects/default-cli-project.json` and `.gemini/antigravity-cli/cache/default_project_id.txt` (id `default-cli-project`). No dotfiles written into the repo workspace.
- `$HOME/Library/Caches/` is created (empty) under a fresh HOME — `~/Library` resolves through `$HOME`, so a redirected HOME keeps cache writes sandbox-contained.

Evidence: `agy-state-writes.txt`.

### 5. Egress (CONFIRMED, controlled-run hosts only)

- `daily-cloudcode-pa.googleapis.com` — model plane: `v1internal:loadCodeAssist`, `fetchAvailableModels`, `streamGenerateContent?alt=sse`, `recordTrajectoryAnalytics`.
- `playwright.azureedge.net`, `playwright-akamai.azureedge.net`, `playwright-verizon.azureedge.net` — playwright driver download attempts (404 for `playwright-1.57.0-mac-arm64.zip`, non-fatal; text prompts work without it).
- Installer channel: `antigravity-cli-auto-updater-974169037036.us-central1.run.app`, `storage.googleapis.com`.
- `accounts.google.com` — OAuth, only when unauthenticated.

Evidence: `agy-run-log-excerpts.txt`.

### 6. Egress control (CONFIRMED)

- `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` honored: with all three set to a dead port, run fails with `proxyconnect tcp: dial tcp 127.0.0.1:1: connect: connection refused` against `daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`.
- `NO_PROXY=*` honored with the same proxy vars → run succeeds (exit 0, `NOPROXYOK`).
- Behavior matches Go `http.ProxyFromEnvironment`; a DAX egress proxy can observe and filter agy traffic.

Evidence: `agy-proxy-tests.txt`.

### 7. Behaviors worth knowing for the worker adapter

- Telemetry: `recordTrajectoryAnalytics` POST to the model plane runs in print mode (log shows `context canceled` on exit); disable flag not yet verified.
- A background process repeatedly logs "You are not logged into Antigravity" even when authenticated — non-fatal noise.
- `settings.json` absent → "cli settings not available, using defaults"; `crashes/crash_*.log` written per run (observed empty).
- `--model` exists on `agy` (contradicts a web source; observed beats docs).

### 8. Governed end-to-end run (CONFIRMED)

Full `dax worker run antigravity` succeeded against the scratch repo
`/tmp/dax-e2e-repo` (seed: `src/math.ts` `add` + a passing test):

- Run `ses_fe2525330ffez8J8eB4J2FsVVz`: `worker:antigravity`, `diff:2`,
  `sandbox:seatbelt`, network full, egress filtered (cooperative-proxy),
  **zero egress denials**, verification `bun test (seatbelt) passed`
  (receipt `2bd68c1d-70c0-4a7a-9997-56dd2662da6a`), and the kernel diff was
  parked at the `patch_apply` approval gate (`apr_0a87a2534520498f`).
- The diff matched the task exactly (added `isEven` to `src/math.ts` + a test
  in `src/math.test.ts`) — DAX's kernel computed it from the checkout, never
  from worker-reported state.

Adapter behaviors verified live and baked into the profile:

- **`--dangerously-skip-permissions` is required.** agy's default
  `toolPermission` is `request-review` and print mode soft-denies every tool
  without an approver ("soft-denying tool confirmation ListDir"); with it set,
  agy logs "auto-approving all tool permissions" and edits flow.
- **agy works in its own scratch workspace** (`~/.gemini/antigravity-cli/scratch`)
  seeded from cwd in print mode, so without `--add-dir` the checkout never
  changes. A *relative* `--add-dir .` is unreliable: in a git-worktree checkout
  agy resolves the repo root (the origin repo, outside the sandbox write
  scope) or falls back to scratch. Only an **absolute** `--add-dir` to the
  checkout targets it. Because profiles are built before the checkout exists,
  the args embed `WORKSPACE_PLACEHOLDER` (`__DAX_WORKSPACE__`) and
  `WorkerRunEffects.runWorker` substitutes the real checkout path at run time.
- The Seatbelt profile allows writes anywhere under `/tmp`/`TMPDIR` (needed for
  worker temp state), which lets a worktree-adjacent origin repo under `/tmp`
  be written; production origins under `~` would be blocked by the profile, so
  the absolute `--add-dir` is what keeps writes in the checkout everywhere.

Egress allowlist finalized to the hosts actually observed in governed runs
(only these were ever reached; no denials on the final run):
`daily-cloudcode-pa.googleapis.com`, `oauth2.googleapis.com`,
`accounts.google.com`, `www.googleapis.com`, `lh3.googleusercontent.com`,
`antigravity-unleash.goog`, `play.googleapis.com`.

Full suite at the commit: typecheck, lint, and **1381 tests pass**.

## Open Questions / Assumptions

- Copy of the real `~/.gemini` into a temp HOME still requested auth; real HOME authenticates via keychain. Unresolved why the composite keychain lookup did not succeed in the copy — **not blocking**: the token-file copy is the reliable sandbox path.
- Whether 1h access-token refresh via the embedded refresh_token works under a constrained sandbox (implied, not stress-tested).
- Whether `agy` has a telemetry-disable flag or config (not verified).
- Browser-tool operations would need a playwright driver download; not exercised (text prompts verified only).

## Residual Risk

- No long-running/`--continue` conversation-continuation test; no `--sandbox` or `--mode plan` exercise.
- Model inference quota/billing unknown (`authMethod=consumer`); models list is not a quota check.
- All tests ran on macOS arm64 with the real operator keychain present; keychain-free Linux behavior untested (DAX worker OS target is a future item).

## Next Actions

1. Phase 2 (DONE): provider enum id `antigravity`, binary `agy`, `WORKER_PROFILES` exported; `worker-adapter.test.ts` asserts `expect(invocation.command[0]).toBe(WORKER_PROFILES[workerId].binary)`; :125 id list is `["claude","codex","gemini","antigravity"]`; `worker:antigravity` providerHint accepted.
2. Phase 2 governed E2E (DONE, this branch): `--dangerously-skip-permissions` + absolute `--add-dir` via `WORKSPACE_PLACEHOLDER` substitution; egress allowlist finalized to the 7 observed hosts; verified `diff:2` + `bun test` passed at the approval gate.
3. Sandbox provisioning: `.gemini/antigravity-cli/antigravity-oauth-token` is the auth material (0600 JSON, refresh_token present, 1h expiry); the other `~/.gemini/antigravity-cli/*` dirs are ephemeral writable state.
4. Optional: verify telemetry-off flag; test `--continue` across restarts.