# DAX UI Revamp Spec (v1)

## Objective

Rebrand DAX TUI UX away from generic command-chat aesthetics and toward a governance-first operations console.

Constraints:

- no architecture rewrite
- no runtime stack change
- keep OpenTUI/Solid foundations
- preserve existing behavior and command engine compatibility

## Product UX direction

### Primary user mental model

DAX is a control plane for AI execution, not a chatbot.

### UI principles

1. Governance visible by default (RAO and PM always legible)
2. Natural language first, command clutter second
3. Operational density without visual noise
4. Fast keyboard usage with progressive disclosure

## Visual system

### Palette direction

- Dark base: deep graphite/blue-black for sustained coding sessions
- Action blue: execution and primary controls
- Teal: healthy system states
- Amber: active risk/attention states
- Red: error/deny states

### Semantic color map

- `primary`: action / active controls
- `secondary`: live infrastructure telemetry
- `accent`: high-attention highlights
- `warning`: RAO pending states
- `success`: connected/healthy states
- `backgroundPanel`: operational surfaces

## Interaction model

### Surface hierarchy

1. Session header: identity + context usage
2. Workspace control strip: DAX / RAO / PM / Pane state
3. Main stream: user + assistant chronology
4. Pane: mode-specific operational context (Artifact / Diff / RAO / PM)
5. Footer: compact system status

### Command model

- Keep natural language as primary path
- Reduce slash command discoverability for non-core controls
- Keep keyboard and internal command actions intact

## First implementation pass (completed)

### Theme tokens

- Updated default DAX theme tokens in:
  - `packages/dax/src/cli/cmd/tui/context/theme/dax.json`
- Moved from warm/purple-heavy blend to governance-oriented blue/teal/amber palette
- Improved diff backgrounds and line-number contrast tokens

### Layout hierarchy

- Home messaging shifted to orchestration/governance framing:
  - `packages/dax/src/cli/cmd/tui/routes/home.tsx`
- Session control strip now surfaces DAX workspace context:
  - RAO pending counts
  - PM marker
  - pane visibility/mode controls
  - file: `packages/dax/src/cli/cmd/tui/routes/session/index.tsx`
- Pane header reframed as DAX operational pane with session/RAO status context
- Footer status language updated to RAO-centric pending state:
  - `packages/dax/src/cli/cmd/tui/routes/session/footer.tsx`
- Header title updated with explicit DAX identity marker:
  - `packages/dax/src/cli/cmd/tui/routes/session/header.tsx`

### Slash declutter (already done in prior pass)

- Removed non-essential slash discoverability for micro-controls while preserving actions.

## Not changed in v1

- Command architecture
- Session orchestration engine
- Tool system / MCP integration
- Prompt pipeline and model streaming
- OpenTUI rendering stack

## Future phases

### v1.1 (still no architecture changes)

- add compact/comfortable density presets
- add governance-focused status badges in home sidebar area
- simplify footer telemetry phrasing further
- improve empty-state copy and first-run onboarding flow

### v2 (optional platform decision)

- evaluate Ink migration only if required for distribution/runtime goals
- treat as full UI rewrite project with explicit parity matrix

## Font guidance

Terminal apps cannot force host fonts programmatically; font selection remains terminal-profile level.

Recommended monospace fonts for DAX:

- JetBrains Mono
- Berkeley Mono
- IBM Plex Mono
- Monaspace Argon

Recommended profile:

- 13-15px size
- 1.15-1.3 line height
- ligatures optional by team preference
