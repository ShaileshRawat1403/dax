# DAX Architecture (Clean-Room)

## Product Principle
DAX is a policy-driven execution system for software delivery. The core contract is RAO:
- Run: propose minimal action to advance a goal.
- Audit: evaluate scope, risk, and policy.
- Override: accept explicit allow/deny/persist decisions.

## Core Services (DAX-native)
1. Policy Engine
   - Own ruleset model, evaluation, and persistence.
   - Enforces allow/ask/deny per tool and pattern.
2. RAO Ledger
   - Append-only audit stream for run/audit/override events.
   - Stored per project with hash-chain capability.
3. Session Runtime
   - Message assembly, tool dispatch, and policy checks.
   - Deterministic execution with explicit audit checkpoints.
4. Tool Registry
   - Declarative tool definitions with permissions and schemas.
5. Storage
   - Project-local state + global state.
   - PM (Project Memory) and ledger tables.
6. CLI + TUI
   - CLI for batch usage and auditing.
   - TUI for interactive sessions with policy panes.

## Module Map (Initial)
- core/
  - session/
  - tools/
  - policy/
  - ledger/
  - storage/
- cli/
  - commands/
- tui/
- packages/dax/src/provider/
- docs/

## Non-Goals
- Copying external agent architectures.
- Prompt or command surfaces identical to other tools.

## Distinctive Features
- RAO audit ledger with per-project approvals.
- Policy Engine as first-class service.
- Deterministic execution tracing with explicit policy checkpoints.
