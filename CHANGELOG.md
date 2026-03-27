# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.8] - 2026-03-27

### Added

- Release-channel handling now treats tagged release builds as the `latest` channel during publish flows.
- Release surfaces now include dedicated checked-in notes for `v1.0.7` and `v1.0.8`.

### Changed

- Reduced startup lag around intent refinement so the workstation becomes responsive faster on first interaction.
- Recovered more of the calmer `v1.0.4` stream feel with steadier narrative emphasis and less visual friction in the session view.

### Fixed

- Stabilized CI around explore-session mocking and teardown.
- Reduced noisy optional-loader logging that made provider startup look less healthy than it was.

## [1.0.7] - 2026-03-27

### Fixed

- Release builds now publish through the stable `latest` channel instead of behaving like preview builds.
- Install and release packaging surfaces were aligned for the `v1.0.7` cut.

## [1.0.2] - 2026-03-24

### Added

- **Google auth lanes**: Clear public-facing choices for Gemini usage
  - Gemini API Key
  - Gemini Subscription Sign-In
  - Custom Google OAuth Client
- **Pro/Plus support**: Code Assist API routing for Gemini Pro/Plus subscriptions
- **DAX logo animation**: Header shows color-cycling "DAX" letters
- **Braille spinner**: Bottom-left shows activity indicator when streaming

### Changed

- **Credentials via env vars**: OAuth client credentials set via environment variables
  - `DAX_GOOGLE_CLI_CLIENT_ID`
  - `DAX_GOOGLE_CLI_CLIENT_SECRET`
- **TUI polish**: Improved borders, dialogs, autocomplete positioning
- **Header animation**: DAX letters cycle colors
- **Auth abstraction**: The public subscription lane may internally use Gemini CLI import or direct subscription sign-in depending on operator setup.

### Fixed

- **Rate limit handling**: Improved retry logic with proper header parsing
- **Quota project support**: Proper `x-goog-user-project` header forwarding
- **Scope modes**: Support for "full" and "compat" via `DAX_GEMINI_OAUTH_SCOPE_MODE`

---

For full release notes and documentation, see the [docs/releases](./docs/releases/) directory.
