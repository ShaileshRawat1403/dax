<p align="center">
  <img src="./dax-logo.svg" alt="DAX logo" width="600">
</p>
<p align="center"><strong>DAX — Deterministic AI eXecution</strong></p>
<p align="center">The execution control plane for AI-assisted SDLC.</p>

---

## Overview

DAX is the execution control plane for AI-assisted SDLC. It is built for teams and ambitious builders who want AI speed with explicit control, traceability, and customization.

The flagship experience is a transcript-first terminal workspace:

- DAX explains what it found, what it is checking, and what happens next.
- risky actions go through explicit review and approval instead of hidden tool calls.
- detailed trace and context stay available on demand without overwhelming the main conversation.

Instead of a free-running coding chat, DAX uses **RAO** as a governed execution loop:

1. **Run** – the model proposes the next action.
2. **Audit** – permission rules and runtime checks evaluate whether the action should proceed, ask, or stop.
3. **Override** – humans allow, deny, or persist the decision.

## Guides

- Full docs index: [docs/README.md](docs/README.md)
- Start here: [docs/start-here.md](docs/start-here.md)
- Non-dev quickstart: [docs/non-dev-quickstart.md](docs/non-dev-quickstart.md)
- Non-dev quick guide: [docs/non-developer-guide.md](docs/non-developer-guide.md)
- Audit agent (beta): [docs/audit-agent.md](docs/audit-agent.md)
- GitHub + CI integration lane: [docs/integrations-github-ci.md](docs/integrations-github-ci.md)
- Build on DAX: [docs/build-on-dax.md](docs/build-on-dax.md)
- Architecture deep dive: [ARCHITECTURE.md](ARCHITECTURE.md)
- Provider setup: [docs/PROVIDERS.md](docs/PROVIDERS.md)
- Peer prerelease install/validation: [docs/prerelease.md](docs/prerelease.md)
- Distribution channels (script/Homebrew/Winget): [docs/distribution.md](docs/distribution.md)
- Release readiness guide: [docs/release-readiness.md](docs/release-readiness.md)
- Workspace decision record: [docs/WORKSPACE_DECISION_RECORD.md](docs/WORKSPACE_DECISION_RECORD.md)
- Repo boundaries: [docs/REPO_BOUNDARIES.md](docs/REPO_BOUNDARIES.md)
- `dax-cli` donor inventory: [docs/DAX_CLI_DONOR_INVENTORY.md](docs/DAX_CLI_DONOR_INVENTORY.md)
- Use `workspace-mcp` with DAX: [docs/WORKSPACE_MCP_WITH_DAX.md](docs/WORKSPACE_MCP_WITH_DAX.md)
- DAX absorption strategy: [docs/DAX_ABSORPTION_STRATEGY.md](docs/DAX_ABSORPTION_STRATEGY.md)

## Workspace Role

DAX is the canonical execution product in the `MYAIAGENTS` workspace.

- `dax`: local-first governed execution product
- `soothsayer`: multi-user web platform and orchestration shell
- `workspace-mcp` in Soothsayer: kernel and policy contract
- `dao`: archived/reference-only architecture line

DAX is responsible for the CLI/TUI, local server/API, session runtime, tool execution, provider integrations, and RAO/PM behavior at the execution layer.

Your `workspace-mcp` kernel from Soothsayer can be used with DAX today as an external local MCP server.
The recommended integration path is documented in [docs/WORKSPACE_MCP_WITH_DAX.md](docs/WORKSPACE_MCP_WITH_DAX.md).

## Repo Boundaries

This repository still contains some older scaffold directories such as `cli/`, `core/`, `tui/`, and `script/build.ts`.
They are not the canonical shipped DAX product surface.

The real product lives under `packages/dax`.
The scaffold paths are retained only as quarantined legacy material until they are removed.

## Who DAX Is For

| Ideal for                                                 | Not optimized for                                   |
| --------------------------------------------------------- | --------------------------------------------------- |
| Engineering teams adopting AI under real delivery rules   | Chat-only experimentation with no governance        |
| Platform and developer productivity teams                 | IDE-first workflows where the editor is the product |
| Technical founders with mixed technical/non-technical ops | “Replace developers” positioning                    |
| Open-source builders who want governed local execution    | AGI-adjacent marketing claims                       |

## Core Capabilities

- Transcript-first terminal workspace (SolidJS TUI) with milestone-based progress and review surfaces.
- Multi-provider support: OpenAI, Google/Gemini, Anthropic, Ollama, more via RAO tools.
- Governed approvals with allow/ask/deny rules, persisted approvals, and audit trace recording.
- Project Memory (PM) stored in `pm.sqlite` for durable context.
- Audit agent (beta): release-readiness and policy checks with structured JSON output.
- ELI12 mode that rewrites responses in plain language.
- Product-facing work surfaces for `Plan`, `Review`, `Changes`, `Context`, and `Docs`.
- Built-in review and diagnostics via `dax approvals`, `dax doctor`, `dax mcp inspect`, and docs workflows via `dax docs`.
- `dax plan` exposes the canonical planning workflow so operators can inspect work before execution.
- Explicit execution previews in `dax run` so operators can inspect the work request before execution begins.
- `dax artifacts` exposes retained outputs such as attachments, truncated tool output references, and session diffs.
- `dax audit` exposes trust posture by summarizing approvals, overrides, evidence presence, and audit findings.
- `dax verify` judges whether a session has enough evidence and governance signal to reach a stronger trust posture.
- `dax release check` judges whether a trusted session is ready for review, handoff, or shipping.
- `dax explore <path>` inspects a repository and returns structured execution-oriented understanding instead of a generic summary.
- Session personalization with `/name`, plus session cleanup with `dax session prune`.
- Theme system with quick-switch profiles.
- Open customization via tools, plugins, agents, and policy/config packs.

## Canonical Workflows

- Start or continue governed work: `dax`, `dax plan`, `dax run`, `dax explore`
- Review and inspect: `dax docs`, `dax mcp`, `dax approvals`, `dax artifacts`, `dax audit`, `dax verify`, `dax release`, in-session review surfaces for approvals, changes, context, and docs
- Diagnose and configure: `dax doctor`, `dax auth`, `dax models`
- Automate and export: `dax serve`, `dax export`, `dax import`, `dax session prune`

## What Else DAX Can Do

Beyond coding tasks, DAX can help with:

- Trust review via `dax audit`, plus release governance and readiness audits (`/audit`, `/audit gate`).
- Documentation quality checks (missing runbooks/guides, remediation steps).
- Policy guardrails via PM rules and reviewable findings metadata.
- CI-friendly audit artifacts (`artifacts/audit-result.json`) for automation.

## Product Pillars

### RAO (Run → Audit → Override)

- Explicit permissions for sensitive actions.
- Persistent approvals for recurring scenarios.
- Human override for high-risk operations.
- Audit and override events recorded for traceability.

### Project Memory (PM)

- Long-lived constraints, preferences, and notes.
- Session continuity across runs.
- Operational memory that stays separate from transient chat state.

### Transcript-First Orchestration UX

- The transcript is the primary surface.
- DAX reports milestone findings instead of raw tool chatter by default.
- `Trace` keeps detailed execution history available without making the chat noisy.
- `Review` appears when decisions are needed.
- `Plan`, `Changes`, `Context`, and `Docs` stay available as supporting surfaces.

### Open Customization

- Customize tools, plugins, agents, prompts, and policies without forking the runtime core.
- Use DAX as a local governed execution layer for your own workflows.

## Flagship TUI

The TUI is the premium DAX experience.

- Header: one state sentence, one useful detail, and only the most relevant actions.
- Transcript: calm SDLC teammate voice with `light`, `guided`, and `operational` stream density.
- Drawer: contextual review surface for `Plan`, `Review`, `Changes`, `Context`, and `Docs`.
- Footer: minimal attention strip for real blockers or the next useful action.

### Normal and ELI12 Modes

Both modes use the same layout.

- Normal mode is concise and implementation-oriented.
- ELI12 keeps the same structure but explains what the result means and what happens next in simpler language.

### Personalization

- Set how DAX addresses you in-session: `/name Shaily`
- Check the current value: `/name status`
- Clear it: `/name clear`
- Use global fallback via config:

```json
{
  "username": "Shaily"
}
```

## Quickstart

### Prerequisites

- Bun `1.3.x`
- Git

### Install

```bash
git clone https://github.com/dax-ai/dax.git
cd dax
bun install
```

### Run DAX

```bash
bun run dev
```

### Run The Repo-Local Build

Use the repo-local launcher when you want the current source tree plus `.dax/dax.jsonc`:

```bash
bun run dax:local
```

### Useful First Commands

```bash
# overall readiness
bun run --cwd packages/dax src/index.ts doctor --json

# docs workflows
bun run --cwd packages/dax src/index.ts docs qa strict

# MCP inspection
bun run --cwd packages/dax src/index.ts mcp inspect workspace_kernel --json
```

### Validate Quality Locally

```bash
bun run typecheck:dax
bun run test
```

### Full Release Verification Pipeline

```bash
bun run release:verify
```

### Build Release Artifacts

```bash
bun run release
```

### Peer Pre-release (GitHub Releases)

- Build release artifacts locally: `bun run release`
- Upload prerelease assets to GitHub (draft): `DAX_VERSION=1.0.0-beta.1 bun run release:publish`
- Publish prerelease immediately: `DAX_VERSION=1.0.0-beta.1 bun run release:publish:live`
- Peer install guide: `docs/prerelease.md`

### Install Peer Build (No Source Checkout)

```bash
curl -fsSL https://raw.githubusercontent.com/dax-ai/dax/main/script/install.sh | DAX_VERSION=v1.0.0-beta.7 bash
```

Why this URL:
- GitHub `releases/latest` only points to stable releases, not prereleases.
- For beta tags, use `script/install.sh` from `main` and set `DAX_VERSION`.

### Install Channels

- macOS/Linux: release install script (recommended today).
- Windows: `dax-windows-x64.zip` release asset (manual PATH setup).
- Homebrew + Winget: publishing workflows are now available in-repo for channel rollout.

## Configuration Snapshot

DAX uses per-project and global config for provider and policy controls. Example:

```json
{
  "enabled_providers": ["openai", "google", "anthropic", "ollama"]
}
```

Default UX profile:

- Primary agents: `build`, `plan`, `explore`, `docs`, `audit` (beta-gated)
- RAO enabled by default
- PM enabled by default

## Supported Customization Patterns

- Tool packs: add new execution capabilities using the tool and plugin contracts.
- Agent and prompt packs: tailor planning, implementation, docs, or audit behavior to your workflow.
- Policy and config packs: ship reusable guardrails, provider settings, and project conventions.

## Current Product Highlights

- Doctor suite for auth, MCP, environment, and project readiness.
- Transcript-first TUI with `Explain`, `Trace`, and contextual `Review` actions.
- Docs workflows available both from CLI (`dax docs ...`) and in-session review surfaces.
- MCP inspection and ping flows with first-class CLI and TUI support.
- Personalized sessions with `/name`.
- Release-readiness guidance and audit flows built into the product.

## Google / Gemini Auth

Use this matrix to keep Google auth modes isolated:

| Model prefix | Provider path | Auth mode | Required setup |
| --- | --- | --- | --- |
| `google/*` | Gemini API | Gemini API key or Google OAuth (email) | `GEMINI_API_KEY` (or OAuth login via `dax auth login`) |
| `google-vertex/*` | Vertex AI | ADC + project | `GOOGLE_CLOUD_PROJECT` + ADC (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`) |
| `google-vertex-anthropic/*` | Vertex Anthropic | ADC + project | Same as `google-vertex/*` |

`google/*` (Gemini API) examples:

```bash
# Recommended: API key mode
export GEMINI_API_KEY=__your_gemini_api_key__

# Optional OAuth email mode
dax auth login
# choose provider: google
# choose method: Sign in with Google (email)
```

`google-vertex/*` examples:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project __your_project_id__
export GOOGLE_CLOUD_PROJECT=__your_project_id__
# optional explicit ADC path:
# export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/adc.json
```

Auth diagnostics:

```bash
# check Google/Gemini + Vertex auth status
dax auth doctor

# check one model target
dax auth doctor google/gemini-2.5-flash
```

Local source command equivalent (if global `dax` is on an older installed beta):

```bash
bun run --cwd packages/dax src/index.ts auth doctor google/gemini-2.5-flash
```

### Troubleshooting

- `insufficient authentication scopes`
  - Cause: Google OAuth token for `google/*` is missing Gemini scope.
  - Fix: re-login with Google OAuth including `https://www.googleapis.com/auth/generative-language.retriever`, or switch to `GEMINI_API_KEY`.

- `invalid authentication credentials` or `expected oauth 2 access token`
  - Cause: token-type mismatch, expired token, or ADC credentials used against `google/*`.
  - Fix: use `google-vertex/*` with ADC, or use Gemini API key / Google OAuth for `google/*`.

- `Google model selected but only Vertex project env is configured`
  - Cause: provider/model auth-mode split mismatch.
  - Fix: either switch model to `google-vertex/*` or configure `GEMINI_API_KEY` / Google OAuth for `google/*`.

- `Authorization callback missing code/state`
  - Cause: opening localhost callback directly or completing auth in a different browser tab/session than the generated sign-in URL.
  - Fix: start `dax auth login`, use that exact URL, and complete consent in the same browser window. Do not manually open `http://localhost:1717/auth/callback`.

- `auth doctor` shows default client id instead of your custom one
  - Cause: old installed CLI or env not loaded in current run path.
  - Fix: run local source command (`bun run --cwd packages/dax src/index.ts ...`) or update installed binary after release.

## UX Defaults & Recommendations

- Terminal font size: `13–15`
- Line height: `1.15–1.3`
- Preferred fonts: `JetBrains Mono`, `Berkeley Mono`, `IBM Plex Mono`, `Monaspace Argon`
- Use high-contrast themes for long sessions (theme cycler built into TUI).

## Security & Governance Notes

- All sensitive actions pass through RAO approvals.
- External-directory access and risky shell commands are permission-gated.
- Policy profile (balanced/strict) can be tuned per project.

## Architecture Overview

```mermaid
flowchart LR
  U[User Prompt] --> TUI[TUI / CLI Surface]
  TUI --> SP[Session Prompt Assembly]
  SP --> SYS[System + Instruction Layers]
  SP --> AG[Agent Selection]
  AG --> LLM[LLM Stream Engine]
  LLM --> PROC[Stream Processor]
  PROC --> RAO[RAO Governance]
  RAO -->|allow| TOOLS[Tool Registry + MCP Tools]
  RAO -->|ask/deny| OV[User Override]
  TOOLS --> PROC
  PROC --> PM[PM Local Memory DB]
  PROC --> OUT[Rendered Output + Telemetry]
```

## Maintainer Pre-Release Checklist

1. `bun install`
2. `bun run typecheck:dax`
3. `bun run test`
4. `bun run release:verify`
5. `bun run release`
6. Smoke-test the TUI on narrow + wide terminals
7. Verify provider login flows (OpenAI, Google/Gemini, Anthropic, Ollama)
8. Verify RAO approvals and policy profile behavior
9. If build regenerates `packages/dax/src/provider/models-snapshot.ts`, include it in the release PR (expected for provider metadata refresh).
10. Confirm docs shipped for auth matrix + troubleshooting + beta release notes.

## License

MIT
