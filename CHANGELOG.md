# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
