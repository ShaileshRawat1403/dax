# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0-beta.1] - 2026-07-11

### Added

- **Governed external workers (BYOA)**: `dax worker run` can invoke Claude Code, Codex CLI, or Gemini CLI through an explicit `worker_run` workflow. DAX owns the disposable checkout, Git-derived diff, scope enforcement, verification, evidence, and approval gate.
- **Pre-run veto card**: operators see task, risk, write scope, forbidden paths, verification commands, field provenance, and active isolation before a run is created.
- **DAX-owned worker verification**: declared checks execute before review with network denied. Failed, missing, unsafe, or crashed checks block the run and emit verification receipts.
- **Flowright capability contract**: DAX exposes invoke, receipt, and delegated-approval surfaces for governed capability calls without duplicating run authority.
- **RunLedger evidence export**: DAX run evidence can be exported through the versioned `runledger.evidence.v0` boundary.

### Changed

- `dax doctor` checks configured provider lanes instead of unrelated optional providers and reports governed-worker isolation readiness separately.
- Worker CLI polling now shows live phase progress and finishes with executable approval, denial, and inspection commands.
- Release packaging owns cross-platform optional dependency installation, so local and GitHub release builds follow the same path.
- Project-memory SQLite connections use a busy timeout, preventing concurrent DAX processes from failing during WAL recovery.

### Security

- Governed workers fail closed unless macOS Seatbelt or Linux bubblewrap passes a live isolation probe. Worker writes are confined to the disposable checkout and temporary storage.
- Verification preview output is redacted before persistence; evidence receipts retain a digest of the exact original check result.
- Dependency updates remove all known high-severity advisories present at the start of this release pass. Five transitive advisories remain (three moderate, two low) and are documented below.

### Known Limitations

- Governed external workers are unavailable on Windows in this beta. Built-in DAX workflows and the standard CLI remain cross-platform.
- Worker execution needs provider network access and does not yet enforce per-provider hostname allowlists. Verification runs with network denied.
- Worker profiles confine writes but permit host reads needed by coding agents. Use a container or VM for a stronger confidentiality boundary.
- Remaining dependency advisories are transitive through OpenTUI, Stryker/ESLint, AI SDK utilities, and documentation/OpenAPI tooling. None are high severity; major dependency migrations are deferred until compatibility work is complete.

## [1.1.2] - 2026-05-16

### Security

- **Dependency hardening**: Reduced known vulnerabilities from 87 (1 critical, 37 high, 44 moderate, 5 low) to 1 (moderate). The remaining advisory affects `file-type` via the TUI library and requires a `@opentui/core` major bump tracked for 1.2.0.
- **Critical fix — protobufjs arbitrary code execution** (GHSA-xq3m-2v4x-88gg): patched via override; reaches DAX through `@opentelemetry/sdk-node`.
- **MCP SDK cross-client data leak** (GHSA-345p-7cg4-v4c7): `@modelcontextprotocol/sdk` bumped from 1.25.2 to ^1.26.0.
- **Hono auth bypass + serveStatic arbitrary file access** (GHSA-3vhc-576x-3qv4, GHSA-f67f-6cw9-8mq4, GHSA-q5qw-h33p-qvwr): `hono` pinned to ^4.12.18 via overrides.
- **Seroval RCE / prototype pollution** (GHSA-3rxj-6cgf-8cfw, GHSA-hj76-42vx-jwp4): pinned to ^1.5.4 (reaches DAX via `solid-js`).
- **Axios prototype pollution + header injection** (GHSA-pf86-5x62-jrwf, GHSA-6chq-wfr3-2hj9): pinned to ^1.15.2 via overrides.
- **OpenTelemetry Prometheus exporter process crash** (GHSA-q7rr-3cgh-j5r3): `@opentelemetry/*` bumped from 0.213.x to ^0.217.0.
- Additional overrides applied to `minimatch`, `path-to-regexp`, `picomatch`, `undici`, `fast-uri`, `flatted`, `lodash`, `defu`, `fast-xml-parser`, `fast-xml-builder`, `brace-expansion`, `follow-redirects`, `tmp`, `diff`, `ajv`.

### Added

- **Rust ledger sidecar** (`dax-ledger`): canonical event-log surface for deterministic replay receipts.
- **Rust structural indexer sidecar** (`dax-indexer`): structural relevance scoring now drives intent planning.
- **Verification harness** (`dax verify`): single command produces a proof bundle covering replay, policy, and audit determinism.
- **Smoke eval ladder gates releases**: `bun run eval:smoke` is now part of the release-verify path, blocking ship on regressions.
- **Runtime pane** with sandbox status surface, including evidence ledger and throttle-state language.
- **dax-ui interaction contract + state resolver**: header, footer, inspector, and operator-mode pane now consume a single environment projection. Attention-state changes drive inspector auto-open instead of ad-hoc triggers.
- **Box-drawing table renderer** applied to session and approval CLI output.

### Changed

- **Runtime guard now pauses and awaits approval** on policy violation instead of failing fast. Pending approval expires correctly on timeout and the listener is properly unsubscribed.
- **Rust path classification** is integrated end-to-end with the policy engine, including sensitive-path approval checks.
- **Codex plugin model discovery is dynamic**: no more hardcoded version list; `gpt-5.4` / `gpt-5.5` subscription models now resolve correctly and the filter pattern is fixed.
- **Prompt formatting** for summary and explainer responses now uses top-tier markdown layout.
- **Internal logging consolidated**: stray `console.*` calls in `plugin/gemini.ts`, `session/persist-state.ts`, and `skills/registry.ts` now flow through the `Log` API.

### Fixed

- **Approval flow end-to-end**:
  - `deny` now actually denies (no longer falls through to allow).
  - `Permission.reply` accepts `apr_*` IDs.
  - Pending-approval source of truth unified across every UI surface.
  - Specific echo, hold window, and auto-close polish in the approval card.
  - RAO pane: stable item refs, reason in title for generic permissions, TDZ crash fixed.
  - Approvals store hardened against TOCTOU and idempotency bugs.
- **Governance**: `.env` and secrets are now gated across every discovery and content tool, not just edit paths.
- **run-gateway**: canonical approvals now bridge to live permissions.
- **ripgrep**: cleanup of extracted archive tolerates ENOENT.
- **runtime-pane**: uses `sdk.fetch` instead of native fetch to avoid `dax.internal` failure.
- **TUI**: approvals pane stable; 401 surfaces a re-auth path.
- **dax-ui**: intervention label corrected; transcript is now narration-only; orphaned state-display calculations removed.

### Developer Experience

- **Skill roster expanded from 7 to 19**. New audit-and-review skills covering CI/CD, infra/release operations, and agentic-AI surfaces:
  - **CI/CD family**: `ci-cd-audit`, `release-pipeline-audit`, `gh-actions-security`
  - **DevOps family**: `deploy-readiness`, `observability-audit`, `incident-runbook`, `db-migration-review`
  - **Agentic/AI family**: `prompt-audit`, `agent-config-audit`, `tool-use-review`, `agentic-loop-audit`, `eval-suite-audit`
- **Shared skill output contract** (`docs/skills/OUTPUT_CONTRACT.md`): impact-ordered finding tables with a five-level severity ladder. All new skills reference it from their own `Output contract` section, so updates propagate centrally.
- **Branch-hygiene enforcement, three layers**:
  - Written rule in `AGENTS.md` + a new `CLAUDE.md` entry point — agent-agnostic, committed
  - Portable git `pre-commit` hook in `.githooks/pre-commit` — refuses commits on `main`/`master`; opt-in per clone via `git config core.hooksPath .githooks`; `DAX_ALLOW_MAIN_COMMIT=1` bypass for already-reviewed release merges
  - Personal Claude Code `PreToolUse` hook (in the gitignored `.claude/settings.local.json`) that blocks `Edit`/`Write` on protected branches

### Known Limitations

- **Tree-sitter HTML injections** are not currently active (query parser incompatibility). Highlights work; embedded `<script>`/`<style>` blocks are not re-tokenized.
- **Nix syntax** uses a community WASM build pending the official `tree-sitter-nix` WASM release.
- **`@opentui/core` `file-type` advisory** (moderate, ASF parser infinite loop) is unresolved — fixing requires a major TUI library bump deferred to 1.2.0.

## [1.1.1] - 2026-04-28

### Added

- **Compatibility Tracking**: Added a release-facing deprecation tracker for legacy fallback and tool-compatibility paths so removals happen intentionally instead of drifting across releases
- **Release Guardrails**: Release and prerelease guidance now require a compatibility review alongside the usual repo-integrity, artifact, and doctor checks

### Changed

- **Todo Progress in Stream**: Session todos now render as a live in-stream plan surface instead of appearing only under a planning-phase marker
- **Legacy Tool Migration**: Prompt and config compatibility for legacy `tools` toggles now flows through one canonical conversion helper instead of multiple duplicated implementations
- **Transcript Summary UX**: Exported transcripts now use structured markdown tables for overview, conversation stats, and tool summaries

### Fixed

- **Session Questions**: Live questions now fall back correctly when projected approval data is incomplete, and free-form answers no longer get stuck in review
- **Operator Controls**: Sidebar/operator actions are now wired to real session behavior instead of cosmetic state only
- **Tool Timing**: Sub-second tool calls now render in milliseconds instead of `0s`
- **Dead Session UI Drift**: Removed the legacy sidebar/question path and related dead helpers that could no longer reflect the live session model

## [1.1.0] - 2026-04-27

### Added

- **Gemini OAuth Unification**: Single "Sign in with Google" flow covering Code Assist and Workspace accounts; auto-reauth triggered on session expiry without user intervention
- **Throttle UX**: `GeminiThrottleError` with per-reason human-readable messages; transient retries surface as timed warning toasts ("Gemini rate limited — retrying in 12s") so users are never silently blocked
- **Rust Sidecars in Release**: `dax-core`, `dax-policy`, and `dax-audit` binaries bundled alongside DAX in all release archives

### Changed

- **No hardcoded credentials**: Google OAuth client ID/secret removed from source; CLI import reads from `~/.gemini/oauth_creds.json`, browser sign-in requires env vars (`DAX_GOOGLE_CLI_CLIENT_ID` / `DAX_GOOGLE_CLI_CLIENT_SECRET`)
- **Icon vocabulary unified**: MCP and LSP status rows use `✓`/`✗`/`⚠`/`·` consistently; receipt check rows match
- **Theme safety**: Removed hardcoded `#ffffff` foreground — uses terminal default for correct light/dark rendering

### Fixed

- **Auth mode persistence**: OAuth callback now saves `mode` field; stored credentials with `mode: "codeassist"` no longer fall through to CLI-file path on reauth
- **Session expiry loop**: `latestOAuth()` truthiness guard fixed so codeassist sessions reauth correctly instead of triggering `GeminiCliSessionExpiredError`

## [1.0.1] - 2026-04-20

### Added

- **Automated Release Workflow**: GitHub Actions now automates cross-platform builds and releases on tag push
- **Cross-Platform Binaries**: Release artifacts include darwin, linux, and win32 builds

### Fixed

- **Release Artifact Upload**: Fixed matrix artifact merging with `merge-multiple: true`
- **Release Archive Creation**: Fixed tar.gz path patterns for GitHub release

## [1.0.0] - 2026-04-16

### Added

- Initial release of DAX (standalone product)
- Full AI execution authority with governance
- TUI with session management, operator workstation, and multi-provider support
