# DAX — Deterministic AI Execution

DAX is a policy-driven execution system for software delivery. It is built around RAO:
- Run: propose minimal action to advance a goal.
- Audit: evaluate scope, risk, and policy.
- Override: accept explicit allow/deny/persist decisions.

## What makes DAX unique
- Policy Engine as a first-class system.
- RAO audit ledger with per-project approvals and event history.
- Deterministic execution tracing with explicit policy checkpoints.

## Repository layout
- core/ — session runtime, tools, policy, ledger, storage
- cli/ — commands and UX
- tui/ — interactive terminal UI
- providers/ — model/provider integrations
- docs/ — documentation

## Development (initial scaffolding)
This repo is a clean-room rebuild. Bootstrap scripts will be added as modules land.
