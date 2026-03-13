# DAX Non-Developer Guide

This guide explains DAX in plain language: what it is, how to use it safely, and how to understand what it is doing.

If you are new, start with [non-dev-quickstart.md](non-dev-quickstart.md) first.

## What DAX Is

DAX is an AI execution system that can define work, inspect files, run commands, and suggest code changes with governance controls.

Core loop:

1. Plan: DAX structures the work before acting.
2. Run: DAX executes the approved work.
3. Override: You approve, deny, or persist a decision.

## What You See In the UI

- Home screen:
  - Start a new request.
  - Pick provider/model.
  - Toggle ELI12 mode for plain-language output.
- Session screen:
  - Main transcript (requests and responses).
  - `What to do now`: the next recommended action when DAX is blocked or waiting.
  - `Move through this session`: transcript navigation and jump controls.
  - `Review and inspect`: approvals, diff, MCP, docs, and PM entrypoints.
  - Side panes:
    - `artifact`: latest generated output.
    - `diff`: file changes.
    - `rao`: approvals/questions.
    - `pm`: project memory context.
    - `audit` (beta): blockers/warnings + remediation guidance.
- Prompt box:
  - Enter tasks.
  - Attach files/pasted content.
  - Submit and monitor stream stages.

## Stream Stages (What DAX Is Doing)

- `thinking`: interpreting your request.
- `exploring`: reading/searching code.
- `planning`: deciding next steps.
- `executing`: making edits/running tools.
- `verifying`: checking results.
- `done`: idle.

## Provider Basics

- `google/*`: Gemini API route (OAuth or API key).
- `google-vertex/*`: Vertex route (ADC + project).
- Other providers: OpenAI, Anthropic, Ollama, etc.

If Google auth is confusing, run:

```bash
dax doctor auth
dax doctor auth google/gemini-2.5-flash
```

## Safe Usage Workflow

1. Start with `dax plan "<intent>"` when the work is not obvious yet.
2. Watch `diff` pane before accepting changes.
3. Use RAO approvals for risky actions.
4. Use `dax approvals` to inspect everything waiting on your decision.
5. Use `dax artifacts` to inspect retained outputs after work runs.
6. Use `dax audit` to inspect trust posture before handoff or release.
7. Use `dax verify <session-id>` to judge whether the session evidence is strong enough for a verified posture.
8. Use `dax release check <session-id>` to judge whether the session is ready for review, handoff, or shipping.
9. Ask DAX to explain decisions in ELI12 mode when needed.
10. Run verification commands/tests before shipping.

## Common Commands

```bash
# Start UI
dax

# Define work before execution
dax plan "Review governance gaps in this repository"

# Configure credentials
dax auth login
dax auth list
dax auth logout

# Diagnose Google auth mode/scope
dax doctor auth

# Inspect pending approvals
dax approvals

# Inspect retained outputs
dax artifacts

# Inspect trust posture
dax audit

# Judge whether a session is actually verified
dax verify <session-id>

# Judge whether a session is ready for handoff or shipping
dax release check <session-id>

# List models
dax models

# SDLC audit workflows (beta)
dax audit run --profile strict
dax audit gate --profile strict

# Inspect low-level event history only when needed
dax audit events --type audit
```

## Troubleshooting

- Prompt input disappears or loses focus:
  - Switch pane/theme once; if persistent, restart session.
  - Beta.6 includes focus lifecycle hardening.
- Google OAuth succeeds but model call fails:
  - Confirm provider/model split (`google/*` vs `google-vertex/*`).
  - Run `dax doctor auth ...` and follow fixes.
- Commands differ between installed and local build:
  - Your installed binary may be on an older beta.

## Release/Upgrade Notes

- Pre-release binaries can change behavior across betas.
- After upgrading, re-run:
  - `dax --version`
  - `dax doctor auth`
