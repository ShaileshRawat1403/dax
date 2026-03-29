# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.10] - 2026-03-30

### Added
- **Refine Contract v2**: Refine now produces richer operator-grade execution contracts with execution profile, contract delta, staged validation, governance hints, and repo impact.
- **Operator Next Moves**: Completed runs can now end with mode-aware next-step guidance when the result leaves the operator in a meaningful decision state.
- **Right-Rail Live Lane**: The workstation pane now explains the live lane, current control surface, and the most useful operator move from the current run state.

### Changed
- **Refine UX**: The refine pane now reads more like an execution contract workbench than a prompt helper, with clearer cards for mission, impact, validation, and governance.
- **Smart Pane Following**: The right pane can now favor `audit` or `changes` once a live run moves into verification or completion instead of staying pinned to workstation unnecessarily.
- **Session Formatting**: Plain-text assistant summaries are enriched into clearer markdown-like structure with stronger headings and lead emphasis.

### Fixed
- **DAX Theme Regression**: Restored the sharper DAX-native palette, removed the unwanted yellow emphasis drift, and kept prompt/refine editor surfaces on the intended dark background.
- **Home / Workstation Noise**: Reduced duplicate state chrome on the home surface and fixed stale `Completed + Review needed` posture on settled runs.

## [1.0.9] - 2026-03-29

### Added
- **Canonical Event-Driven Lifecycle**: Replaced property-based state with an immutable RunEvent stream as the system of record.
- **Projection-First Workstation**: TUI now derives all views (narrative, diffs, interventions) from pure event stream projections.
- **Hardened Interventions**: Formal model for operational blocks (ambiguity, recovery, risk) with unique `interventionId` tracking.
- **Speculative Previews**: Real-time projection of "Proposed Changes" into the Diff Pane before approvals are granted.
- **Operational Narrative**: High-signal, evocative narrative feed driven by pre-computed operational messages.
- **Replay Compatibility**: Robust state reconstruction from both legacy and canonical event families.
- **Truthful Readiness Diagnostics**: `dax doctor` now distinguishes product readiness from optional integration issues and surfaces clearer MCP remediation.
- **First-Run Operator Guidance**: Home screen now explains safe first steps, approvals, and when to use `dax doctor`.

### Changed
- **Trust Normalization**: Retired legacy `trust.updated` events in favor of the canonical `audit.posture_updated` family.
- **Workstation UI**: Integrated intervention markers and unified speculative/historical diff views.
- **Governance Language**: Approval, intervention, and proposed-change wording now reads more like an operator workflow and less like schema state.
- **Default Theme Direction**: DAX now prefers its native operator theme and cooler control-plane palette.

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
