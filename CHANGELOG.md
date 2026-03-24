# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-03-24

### Added

- **3 Google auth options**: Clear choices for users - API Key, CLI Import, Sign in with Google
- **Auth method descriptions**: All provider auth methods now include helpful descriptions visible in the TUI auth dialog
- **DAX logo animation**: Header shows color-cycling "DAX" letters (matches home page style)
- **Braille spinner**: Bottom-left shows activity indicator when streaming
- **Open Source Stack documentation**: Comprehensive deployment guide and roadmap for self-hosted DAX

### Changed

- **TUI prompt border**: Added top border to prompt input area for visual clarity
- **Autocomplete dropdown**: Improved positioning and border styling
- **Dialog styling**: Consistent rounded borders across all dialogs
- **Header animation**: DAX letters cycle colors, braille spinner replaces pulsing dot

### Fixed

- **Rate limit handling**: Improved retry logic with proper header parsing for 429 responses
- **Quota project support**: Proper `x-goog-user-project` header forwarding for Google Cloud billing
- **OAuth scope modes**: Support for "full" and "compat" OAuth scope modes via `DAX_GEMINI_OAUTH_SCOPE_MODE`

## [0.1.0] - 2026-03-09

### Added

- Initial release of DAX (Deterministic AI Execution)
- Terminal Workstation (TUI) with stage tracking
- Workflow engine with artifact pipeline
- Session lifecycle management with governance signals
- Trust scoring system
- CLI commands for workflow operations
- Provider support for OpenAI, Anthropic, Google/Gemini, and Ollama

---

For full release notes and documentation, see the [docs/releases](./docs/releases/) directory.
