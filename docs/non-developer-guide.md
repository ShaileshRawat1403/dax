# DAX Non-Developer Guide

This guide explains DAX in plain language: what it is, how to use it safely, and how to understand what it is doing.

## What DAX Is

DAX is an AI assistant that can inspect files, run commands, and suggest code changes with governance controls.

Core loop:

1. Run: DAX proposes or starts an action.
2. Audit: DAX checks risk/policy.
3. Override: You approve, deny, or persist a decision.

## What You See In the UI

- Home screen:
  - Start a new request.
  - Pick provider/model.
  - Toggle ELI12 mode for plain-language output.
- Session screen:
  - Main transcript (requests and responses).
  - Side panes:
    - `artifact`: latest generated output.
    - `diff`: file changes.
    - `rao`: approvals/questions.
    - `pm`: project memory context.
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
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```

## Safe Usage Workflow

1. Start with a small request.
2. Watch `diff` pane before accepting changes.
3. Use RAO approvals for risky actions.
4. Ask DAX to explain decisions in ELI12 mode when needed.
5. Run verification commands/tests before shipping.

## Common Commands

```bash
# Start UI
dax

# Configure credentials
dax auth login
dax auth list
dax auth logout

# Diagnose Google auth mode/scope
dax auth doctor

# List models
dax models
```

## Troubleshooting

- Prompt input disappears or loses focus:
  - Switch pane/theme once; if persistent, restart session.
  - Beta.6 includes focus lifecycle hardening.
- Google OAuth succeeds but model call fails:
  - Confirm provider/model split (`google/*` vs `google-vertex/*`).
  - Run `dax auth doctor ...` and follow fixes.
- Commands differ between installed and local build:
  - Your installed binary may be on an older beta.

## Release/Upgrade Notes

- Pre-release binaries can change behavior across betas.
- After upgrading, re-run:
  - `dax --version`
  - `dax auth doctor`

