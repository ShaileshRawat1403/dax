# Changelog

All notable changes to DAX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.26] - 2026-04-08

### Added

- **Projection-Native Workstation**: Fully transitioned the TUI to a projection-native architecture. The workstation now consumes canonical run truth directly from the server (`runs.projections` and `runs.overview`), eliminating local state reconstruction and split-brain inconsistencies.
- **Run Overview Integration**: Home route now displays a rich, list-oriented operator view of active and recent runs driven by the server.

### Fixed

- **SDK Type Integrity**: Hardened the run contract with precise type metadata, ensuring the generated SDK provides robust, well-named types for workstation projections.
- **Stability**: Resolved regressions in session timeline and audit history rendering by centering on the server-backed projected run.

## [1.0.25] - 2026-04-08

### Fixed

- **Gemini Subscription Flow**: Restored direct browser-based sign-in for Gemini Pro/Plus, avoiding the forced CLI dependency.
- **Claude Pro/Max Subscription Lane**: Fixed a bug in the Anthropic plugin's network logic and added missing beta headers (`interleaved-thinking`, `fine-grained-tool-streaming`) for modern models like Haiku.
- **Child Provider Plugin Matching**: Fixed a core issue where plugins for parent providers (Google/Anthropic) were not correctly applied when using child provider IDs (`gemini`, `claude-code`).
- **Reference Errors**: Resolved `ReferenceError: iife is not defined` in multiple plugins.

### Added

- **Expanded Release Artifacts**: Expanded standard release packaging to include all built variants (baseline, musl) for maximum cross-platform compatibility (11 unique binaries).

## [1.0.21] - 2026-04-06

### Added

- **Gemini Project Resolution Fix**: `resolveCloudCodeProject` now uses refresh token fallback to resolve the correct GCP project (e.g., `inlaid-airway-pjcz2`) instead of defaulting to `"default"` which caused 403 errors.
- **Gemini SSE Chunk Timeout**: 10s timeout on idle SSE streams prevents indefinite hangs when the Code Assist API stops sending data.
- **Gemini Scheduler Improvements**: Reduced throttle retry delay from 15s to 3s, capped at 8 retries with proper backoff.

### Changed

- **Gemini Throttle Delay**: Reduced from 15s to 3s for faster recovery from 429 rate limits.
- **Anthropic Plugin**: Restored Pro/Plus OAuth method with token refresh and loader.
- **Claude Code Plugin**: Restored Pro/Plus OAuth method with token refresh and loader.
- **Auth Callback Retry**: When OAuth callback returns `{ type: "failed" }`, throws `OauthMissing` instead of `OauthCallbackFailed` so TUI shows "press r to retry" instead of fatal error.
- **Minimal Header Persona**: Removed "Persona:" label, kept glyph + name only.
- **Prompt Box Cleanup**: Removed duplicate model name display, workflow mode moved to footer.
- **Footer Redesign**: Clean layout with lifecycle state, workflow mode, MCP/LSP status, and action shortcuts.
- **Claude Pro/Plus Auth**: Restored in both `claude-code` and `anthropic` providers with proper OAuth method display in TUI.

### Fixed

- **Gemini Session Persistence**: 3-step recovery chain for CLI-imported credentials — re-reads file, tries direct refresh, checks recent file modification.
- **Gemini Project 403**: Fixed `resolveCloudCodeProject` returning `"default"` instead of actual project ID.
- **models-snapshot.ts**: Added to .gitignore — auto-generated file no longer tracked.
- **Build.ts LSP Error**: Resolved TypeScript error for `@parcel/watcher` devDependency access.

## [1.0.20] - 2026-04-06

### Added

- **Footer Component**: Added dedicated footer bar with lifecycle state, workflow mode, MCP/LSP status, and action shortcuts.
- **Workflow Mode in Footer**: Clickable workflow mode badge (Plan/Build/Explore/Docs/Audit) moved from prompt box to footer.

### Changed

- **Minimal Prompt Box**: Removed model name display, workflow mode badge, and "tab" label. Prompt box now shows only ELI12 toggle and Submit button.
- **Professional Footer Design**: Clean, aligned footer with consistent badge styling, no emojis, proper responsive behavior.
- **Claude Pro/Plus OAuth Restored**: Both `claude-code` and `anthropic` providers now show API Key and Pro/Plus Sign-In options in TUI.
- **Build.ts LSP Fix**: Resolved TypeScript error for `@parcel/watcher` devDependency access.

### Removed

- **Duplicate Model Name**: Removed redundant model name display from prompt box (already shown in provider selection).
- **Emoji Icons**: Removed all emoji icons from prompt box and footer for professional appearance.

## [1.0.19] - 2026-04-06

### Added

- **Gemini Session Persistence Fix**: 3-step recovery chain for CLI-imported credentials — re-reads file, tries direct refresh, checks recent modification.
- **UX Contract Components**: Phase bar, role-tagged transcript, approval sheet, trust ribbon, artifact drawer.
- **Gemini Subscription Scheduler**: Serial request queue with concurrency=1, adaptive pacing, and disk-persisted cooldown.
- **Context Tool Grouping**: Consecutive read/glob/grep/list tools collapsed into single "Gathering context" block.
- **Inline vs Block Tool Rendering**: Read-only tools as single-line, heavy tools as bordered boxes.
- **Animated Status Titles**: Running tools show pulsing spinner animation.
- **Responsive Sidebar**: Auto-hides on terminals < 80 cols.

### Changed

- **models-snapshot.ts**: Added to .gitignore — auto-generated file no longer tracked.

### Fixed

- **Anthropic Pro/Plus Auth**: Restored OAuth method with token refresh and loader.
- **Footer Design**: Clean layout with status indicators, no emojis, proper alignment.

## [1.0.18] - 2026-04-06

### Added

- **Gemini Subscription Scheduler**: Serial request queue with concurrency=1, adaptive pacing, and disk-persisted cooldown for Gemini Pro/Plus subscription lane.
- **Provider Pressure Tracking**: Real-time `providerPressure` state in run governance with lane, throttles, in-flight, and queue length metrics.
- **UX Contract Architecture**: Formalized 4-layer architecture (Execution Kernel, Projection, Interaction, Authoring) in `docs/UX_CONTRACT.md`.
- **Phase Bar**: Lifecycle progression ribbon (`Intent → Plan → Approval → Execution → Verification → Output`) in session header.
- **Role-Tagged Transcript**: Sub-agents mapped to specialist roles (`EXPLORER`, `PLANNER`, `REVIEWER`, `VERIFIER`, `AUDITOR`, `EXECUTOR`) with distinct theme colors.
- **Trust Ribbon**: Persistent header showing trust posture (`CLEAR`/`REVIEW`/`BLOCKED`), pending approvals count, and verification status.
- **Artifact Drawer**: Evidence-forward sidebar showing files/reports/metadata counts with artifact listing.
- **Context Tool Grouping**: Consecutive read/glob/grep/list tools collapsed into single "Gathering context" block.
- **Inline vs Block Tool Rendering**: Read-only tools as single-line, heavy tools (bash, edit, write) as bordered boxes.
- **Animated Status Titles**: Running tools show pulsing spinner animation (`◐◑◒◓`), completed show `✓`, errors show `✗`.
- **Approval Sheet Enhancement**: Governance summary (files touched, mutations) added to permission prompts alongside risk callouts.

### Changed

- **Minimal Workflow Hint**: Replaced long "Tab: cycle Plan → Build → Explore → Docs → Audit" with compact mode badge + `tab`.
- **Responsive Sidebar**: Auto-hides on terminals < 80 cols. Layout stacks vertically below 120 cols.
- **Redesigned Footer**: Three-zone layout with shortcut hints (`^R` refine, `^K` stash, `^G` diff), MCP/LSP indicators, and compact action buttons.
- **Gemini Auth Persistence**: 3-step recovery chain for CLI-imported credentials — re-reads file, tries direct refresh, checks recent modification before throwing expired error.

### Fixed

- **Gemini Session Persistence**: Resolved issue where closing DAX required re-running `gemini` — now re-reads CLI creds file on restart and recovers fresh tokens automatically.
- **Placeholder Claude Pro/Plus Auth Removed**: Removed non-functional OAuth placeholder, keeping only reliable API Key auth for Claude providers.

## [1.0.17] - 2026-04-05

### Added

- **Claude Pro/Plus Integration**: Added native support for the `claude-code` provider and expanded `anthropic` provider auth options.
- **Anthropic API Key Auth**: Established robust, dedicated API Key authentication flows for both Claude and Claude Code providers.

### Changed

- **TUI Clarity**: Renamed confusing tab cycling to `Workstation: auto/pinned/hidden` for explicit workstation visibility control.
- **Explicit Persona Selection**: Made the persona selector visible and explicit in the header instead of implicit tab cycling.
- **Completion Proof Hardening**: Separated proof evaluation from derivation to guarantee execution purity and eliminate state drift during verification.
- **Strict Execution Mode Boundaries**: Enforced run state validation at the runtime guard level, blocking mutations on vague requests or boundary drift.

### Fixed

- **ELI12 Duplication**: Removed redundant ELI12 mode rendering from the header, moving it to the prompt box where the mode hint naturally belongs.
- **QUEUE Control Visibility**: Hid the legacy QUEUE control, which clutterd the UI and didn't align with the deterministic execution cycle.
- **Approval Budget Limits**: Implemented hard blocks for `maxApprovalRequests` to stop runaway recursive approvals.
- **Gemini Token Refresh**: Fixed Gemini token refresh failing on CLI imported sessions that lack explicit client secrets.

## [1.0.16] - 2026-04-04

### Changed

- **Unified Workflow Posture**: Formally defined Workflow Mode as a global workstation preference rather than session-local state. This ensures a consistent operating posture across Home and Session views.
- **Synchronized Agent State**: Added a global synchronization effect that keeps the workstation's workflow mode in lockstep with the active agent.

### Fixed

- **TUI Tab Cycling**: Resolved a regression where the Tab key would stop toggling agents once a session started.
- **Reactive Mode Labels**: Fixed non-reactive indicator labels in the prompt box; the current workflow mode now updates instantly upon switching.
- **Agent Ring Fallback**: Improved cycling logic to robustly handle specialized or non-primary agents, ensuring the operator can always return to the primary workflow ring.

## [1.0.15] - 2026-04-03

### Changed

- **Quiet Mode Enforcement**: Hardened "quiet" mode to hide non-critical right-pane chrome while preserving mandatory intervention visibility.
- **Memory Surface Activation**: Fully enabled the `note`, `list`, and `rules` memory tabs, providing live views of PM-backed operational context.
- **Stream Stability**: Improved coupling between the left narrative stream and right workstation pane to prevent flickering during stage transitions.

### Fixed

- **Initialization Race**: Resolved a memo initialization order issue that caused intermittent crashes in the session route.
- **ELI12 Transparency**: Ensured ELI12 explanation mode remains strictly presentational and does not drift into governance or permission logic.

## [1.0.14] - 2026-04-03

### Added

- **Deterministic Completion Proofs**: Introduced a hard evidence-based gate for mutating runs. Completion now requires verifiable receipts for all mutations and validation commands.
- **Production Guard Defaults**: DAX now defaults to `enforce` mode in production builds, ensuring safety gates cannot be bypassed without explicit override.
- **Cross-Platform CI Matrix**: Automated validation now runs on `ubuntu-latest`, `macos-latest`, and `windows-latest` to guarantee stability across all major operating systems.
- **Doom Loop Breaker**: Consolidated tool-call fingerprinting to detect and block successive identical attempts, preventing automated retry loops.

### Changed

- **TUI Stability Pass**: Optimized the Workstation pane for high-signal production use. Reorganized into deterministic sections: Status, why blocked, approvals, completion proof, and next steps.
- **Header Signal Muting**: Header and stream status chips are now suppressed when the Workstation pane is active to provide a single, consistent source of truth.
- **Harden Path Security**: Updated path normalization to use canonical resolution (`realpath`), closing potential escapes via symlinks or complex traversal.

### Fixed

- **JSX Nesting & Syntax**: Resolved syntax errors in the TUI routes and synchronized component logic with the latest SDK version.
- **Schema Synchronization**: Fixed mismatches between Session intent contracts and the Execution runtime state.

## [1.0.13] - 2026-04-02

### Changed

- **Boundary Hardening for Vague Runs**: Runtime guard now blocks mutating actions when intent is vague and no concrete scoped contract targets are present.
- **Primary Loop Safety Rails**: Session loop now enforces a hard primary step budget to prevent indefinite drift on under-specified tasks.

### Fixed

- **Codex Boundary Drift Path**: A vague prompt path that previously escalated into `apply_patch` under weak constraints is now stopped by trust guards.
- **Provider Stall Recovery**: Session processor now enforces deterministic stream stall timeout behavior so long-running provider silence does not hang runs indefinitely.

## [1.0.12] - 2026-04-02

### Added

- **Bounded Reflection History**: Reflection checkpoints now keep a compact recent history that can be surfaced in the workstation instead of acting like a one-shot hidden tool event.
- **Mode Regression Coverage**: Added focused tests around session display behavior, persona rendering, reflection pruning, and non-interactive planning so the new workstation surfaces stay honest as DAX evolves.

### Changed

- **Mode Truthfulness**: `plan`, `explore`, `docs`, and `audit` now describe their real authority and constraints more accurately instead of drifting into cross-mode promises.
- **Provider-Neutral Reflection Guidance**: Reflection policy now lives in the shared session prompt path rather than being taught primarily through one provider family.
- **Operator Controls**: `DISPLAY_MODE` and `QUEUE` in the session header now control real UI behavior instead of only toggling stored state.

### Fixed

- **Header Action Chips**: Restored click handling for header actions so visible operator controls are interactive again.
- **Shell Verification Allowlist**: Hardened the parser and tests so safe verification commands like `python -m pytest`, `go test ./...`, and `npm/pnpm exec vitest run` behave as intended.
- **Non-Interactive Planning Stability**: `dax plan` now only reports ready state when a canonical plan artifact exists, with safe materialization fallback when the assistant draft needs to be captured into a plan file.

## [1.0.11] - 2026-03-30

### Added

- **Session Close Snapshot**: Closing the TUI now leaves behind a concise DAX-branded handoff with resume command, session title, and useful run metrics when available.
- **Exit Message Coverage**: Added regression tests for the close banner so the handoff stays compact and truthful as the TUI evolves.

### Changed

- **OTel Startup Noise**: The default “OTel disabled” message is now debug-level so normal local sessions do not look unhealthy when telemetry is intentionally off.
- **Planning Fallback Honesty**: `dax plan` now treats assistant-only drafts as incomplete until the canonical plan file exists, instead of presenting them as ready execution plans.

### Fixed

- **Release Audit Docs Gate**: Added the required docs section headings so strict audit passes cleanly before release.
- **Status Surface Robustness**: LSP and skills remain visible as operator-facing capabilities even when they are idle rather than actively attached.

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
