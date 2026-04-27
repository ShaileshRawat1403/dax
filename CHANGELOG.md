# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
