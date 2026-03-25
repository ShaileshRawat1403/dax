# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-03-24

### Added

- **4 Google auth options**: Clear choices for users
  - Gemini API Key - free tier
  - Import from Gemini CLI - Pro/Plus import
  - Sign in with Google - direct browser sign-in
  - Your Google OAuth Client - custom credentials
- **Pro/Plus support**: Code Assist API routing for Gemini Pro/Plus subscriptions
- **DAX logo animation**: Header shows color-cycling "DAX" letters
- **Braille spinner**: Bottom-left shows activity indicator when streaming

### Changed

- **Credentials via env vars**: OAuth client credentials set via environment variables
  - `DAX_GOOGLE_CLI_CLIENT_ID`
  - `DAX_GOOGLE_CLI_CLIENT_SECRET`
- **TUI polish**: Improved borders, dialogs, autocomplete positioning
- **Header animation**: DAX letters cycle colors

### Fixed

- **Rate limit handling**: Improved retry logic with proper header parsing
- **Quota project support**: Proper `x-goog-user-project` header forwarding
- **Scope modes**: Support for "full" and "compat" via `DAX_GEMINI_OAUTH_SCOPE_MODE`

---

For full release notes and documentation, see the [docs/releases](./docs/releases/) directory.
