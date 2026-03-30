<p align="center">
  <br>
  <img src="./dax-logo.svg" alt="DAX logo" width="550">
  <br>
  <img src="./dax-hound.svg" alt="DAX-hound mascot" width="320">
  <br>
  <b>Deterministic AI eXecution</b>
  <br>
  <i>The execution control plane for AI-assisted SDLC.</i>
</p>

<p align="center">
  <a href="https://github.com/ShaileshRawat1403/dax-tui/actions/workflows/ci.yml">
    <img src="https://github.com/ShaileshRawat1403/dax-tui/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI Status">
  </a>
  <a href="https://github.com/ShaileshRawat1403/dax-tui/releases">
    <img src="https://img.shields.io/github/v/release/ShaileshRawat1403/dax-tui?color=blue&label=release" alt="Latest Release">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  </a>
  <a href="https://bun.sh">
    <img src="https://img.shields.io/badge/runtime-Bun-black?logo=bun&logoColor=white" alt="Bun">
  </a>
  <a href="https://github.com/ShaileshRawat1403/dax-tui">
    <img src="https://img.shields.io/badge/DAX--hound-trained-orange?logo=dataadventurer&logoColor=white" alt="DAX-hound Trained">
  </a>
</p>

---

## Overview

**DAX** is a **projection-first governed execution workstation** designed for engineering teams and ambitious builders. Driven by a canonical event language, DAX treats AI reasoning and tool execution as a verifiable audit trail rather than a black box.

While standard AI chat interfaces are built for conversation, DAX is built for **delivery**. It provides explicit control, traceability, and governance over AI operations within your software development lifecycle.

### One-Line Positioning

**DAX is the governed execution workstation for AI-driven software work, giving teams approvals, replayability, and audit-grade control instead of black-box agent behavior.**

### ⚖️ The RAO Governance Loop

DAX replaces free-running autonomy with the **RAO** (Run-Audit-Override) model:

1.  **Run**: The model proposes a technical action or plan.
2.  **Audit**: Automated permission rules and safety gates evaluate the action.
3.  **Override**: Human operators review, allow, or persist decisions via high-fidelity TUI surfaces.

---

## ✨ Core Capabilities

- **Governed Workstation**: A dual-surface TUI with a narrative execution stream and a dedicated control pane for changes, audits, and approvals.
- **Multi-Provider Substrate**: Seamless integration with OpenAI, Google Gemini, Anthropic, Ollama, and custom MCP servers.
- **Built-In Skills**: Ships first-party workflow skills such as `repo-explore`, `git-review`, `release-readiness`, and `artifact-audit`.
- **Project Memory (PM)**: Durable, cross-session operational memory stored in a local SQLite engine.
- **ELI12 Mode**: Real-time response translation for non-technical stakeholders without losing technical precision.
- **Professional Tooling**:
  - `dax explore`: Structured repository analysis and shape detection.
  - `dax audit`: Real-time trust posture assessment.
  - `dax verify`: Evidence-based session validation.
  - `dax plan`: Inspect and refine task graphs before execution.

## 🧭 How DAX Differs

DAX is not trying to be the fastest “AI coding assistant” in an editor tab. It is trying to be the most trustworthy execution system when the work actually matters.

| Tool | Core mental model | Strength | Where DAX is different |
| :--- | :--- | :--- | :--- |
| **Cursor** | AI-native coding IDE | Fast in-editor generation and editing | DAX centers approvals, replay, audit trail, and governed execution instead of IDE convenience |
| **Codex** | Strong agentic coding runtime | High implementation throughput and coding depth | DAX treats the run as the product, with explicit intervention and approval objects |
| **Claude Code** | Terminal-native coding agent | Strong repo reasoning and CLI flow | DAX is more operator-first, with canonical run state, speculative previews, and recovery surfaces |
| **DAX** | Governed execution workstation | Control plane for AI work in real repositories | Purpose-built for traceability, approval-aware operations, and reviewable delivery |

### What DAX Should Win On

- clear pause and approval semantics
- evidence-forward diffs before mutation
- replayable run state instead of chat archaeology
- trust, audit, and release-readiness workflows
- local operator memory that improves continuity without pretending to be magic

---

## 📖 Documentation Index

| Category              | Guides                                                                                                                                                                                                                                             |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Getting Started**   | [What Is DAX?](./docs/product/WHAT_IS_DAX.md) • [In Simple Words](./docs/product/DAX_IN_SIMPLE_WORDS.md) • [Quickstart](./docs/product/QUICKSTART.md) • [Start Here](./docs/product/start-here.md) • [Provider Setup](./docs/product/providers.md) |
| **Product & Use**     | [User Guide](./docs/product/USER_GUIDE.md) • [Intent Guide](./docs/product/INTENT_GUIDE.md) • [Tool & Risk Matrix](./docs/product/TOOLS_AND_RISK_MATRIX.md) • [Runs, Approvals & Recovery](./docs/product/RUNS_APPROVALS_AND_RECOVERY.md) • [Workflows](./docs/product/WORKFLOWS.md) • [Positioning](./docs/product/POSITIONING.md) • [Roadmap](./docs/product/ROADMAP.md) |
| **Architecture**      | [How DAX Works](./docs/architecture/HOW_DAX_WORKS.md) • [Full Architecture](./docs/architecture/ARCHITECTURE.md) • [Trust Model](./docs/architecture/DAX_TRUST_MODEL.md) • [Execution Model](./docs/architecture/DAX_EXECUTION_MODEL.md)           |
| **Open Source Stack** | [Stack Roadmap](./docs/OPEN_SOURCE_STACK_ROADMAP.md) • [Deployment Guide](./docs/OPEN_SOURCE_STACK_DEPLOYMENT.md)                                                                                                                                  |
| **Governance**        | [Policy Tuning](./docs/product/POLICY_TUNING.md) • [Project Memory](./docs/product/PROJECT_MEMORY.md) • [Transparency & Limitations](./docs/product/TRANSPARENCY_AND_LIMITATIONS.md) • [Write Governance](./docs/features/DAX_WRITE_GOVERNANCE.md) |
| **Context**           | [Builder's Note](./docs/BUILDERS_NOTE.md) • [Non-Developer Guide](./docs/product/NON_DEVELOPERS.md)                                                                                                                                               |

---

## 🛠️ Installation

### 🍎 macOS & 🐧 Linux

The recommended way to install the DAX binary is via the universal installation script:

```bash
# Install the latest version
curl -fsSL https://raw.githubusercontent.com/ShaileshRawat1403/dax-tui/main/script/install.sh | bash
```

### 🍺 macOS & 🐧 Linux via Homebrew

If you prefer Homebrew, DAX is also available from the public tap:

```bash
brew install ShaileshRawat1403/tap/dax
```

### 🪟 Windows

You can install DAX using **WinGet**:

```powershell
winget install DaxAi.DAX
```

### 🌿 Local Development

If you are contributing to this repository, you can link your local version globally:

```bash
bun install
cd packages/dax
bun link
```

### Verification

After installation, verify it works by running:

```bash
dax --version
```

### Google / Gemini auth note

For most users, DAX will show three Google auth options:

- `Gemini API Key`
- `Gemini Subscription Sign-In`
- `Custom Google OAuth Client`

`Gemini Subscription Sign-In` uses your local `gemini` CLI session when available, and falls back to direct browser sign-in when `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` are configured.

If you inspect the source, you may also see more specific internal Gemini method names. Those are implementation details under the same public subscription lane, not extra user-facing choices.

Authentication is local to your machine and OS user account. DAX does not ship someone else's subscriptions to other users. If a new user installs DAX on their own machine, they authenticate with their own account, keys, or local `gemini` login.

### If You’re Not a Developer

Start with [DAX in Simple Words](./docs/product/DAX_IN_SIMPLE_WORDS.md) and the new [Non-Developer Guide](./docs/product/NON_DEVELOPERS.md).

Those guides explain:

- what DAX actually does in plain English
- which model setup is easiest
- what to expect when DAX pauses for approval
- what common messages like rate limits or re-auth prompts mean

## Builder's Note

DAX is not just a codebase. It is an attempt to make AI systems feel less like improv and more like operations.

It was built from a systems-thinking, orchestration, and technical-communication perspective, with AI-assisted development as part of the method rather than something quietly hidden in the basement. If you want the fuller context behind the project, read the [Builder's Note](./docs/BUILDERS_NOTE.md).

---

## 🏗️ Workspace Integration

DAX is part of a larger ecosystem designed for enterprise-grade AI orchestration:

- **`dax`**: The local-first execution authority and developer workstation.
- **`soothsayer`**: The multi-user web platform for centralized governance and observation.
- **`workspace-mcp`**: The shared policy and capability kernel.
- **`picobot`**: Thin ingress for multi-channel (Telegram, WhatsApp, etc.) via `repo_analyze` and `draft_and_approve` workflows.

### Open Source Stack

DAX ships with a production-ready integration layer for external consumers:

| Component          | Purpose                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **FastMCP**        | External API substrate — 7 governed tools (run.create/get, approvals, recovery) on port 4730 |
| **GitHub Actions** | `dax-analyze` composite action for PR-gated repo analysis                                    |
| **NATS/JetStream** | Event bus for run lifecycle, approvals, and recovery fan-out                                 |
| **Infisical**      | Secrets management — credentials fetched at startup, graceful fallback to env vars           |
| **ZITADEL**        | Identity and JWT auth — actor claims propagated through FastMCP calls                        |
| **OpenTelemetry**  | Traces and metrics export via OTLP HTTP                                                      |

See the [Stack Roadmap](./docs/OPEN_SOURCE_STACK_ROADMAP.md) and [Deployment Guide](./docs/OPEN_SOURCE_STACK_DEPLOYMENT.md) for full details.

---

## Quickstart

### Prerequisites

- [Bun](https://bun.sh) `1.3.x`
- Git

### Installation

```bash
git clone https://github.com/ShaileshRawat1403/dax-tui.git
cd dax-tui
bun install
```

### Usage

```bash
# Start the interactive workstation
bun run dev

# Run a quality check
bun run test
```

---

## ⚠️ Disclaimer & Safety

**DAX is professional software for governed AI execution.**

- **HITL Required**: Always review critical actions. DAX is an assistant, not a replacement for engineering judgment.
- **Data Privacy**: All session data and API keys are stored locally unless explicitly integrated with a remote provider.
- **Model Accuracy**: Results depend on the underlying LLM. Verify all generated code and configurations.

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for standards and setup instructions.

If DAX is useful to you, fork it, explore it, and open a PR. Great contributions are not limited to code. Clearer docs, safer workflows, better onboarding, better approvals UX, and sharper trust/governance surfaces all move the project forward.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
