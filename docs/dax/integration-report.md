# DAX Integrations Plan & Status Report

## Overview

DAX is designed to be the execution authority, but it relies on an ecosystem of integrations for tool execution, message transport, auth, and UX. This report summarizes what has been implemented and what remains in the pipeline.

---

## 1. What's Done (Implemented & Hardened)

### 🟢 Core Determinism & Replay

- **RunState & Event Log**: DAX successfully records state transitions as events.
- **Replay & Recovery**: The `replayRunState()` reconstructs DAX states from logs. Interrupted runs are recovered safely.
- **Contract Immutability**: The execution contract is locked via `ContractGuardian` at runtime. Attempts to mutate it trigger a `run.failed` event with `contract_mutation`.
- **Deterministic Approval IDs**: SHA-256 hashes generated from the runtime context replace random UUIDs for approvals.

### 🟢 Ingress Interfaces

- **Picobot WhatsApp/Telegram**:
  - Configured as the thin ingress layer via `dax.py` and `dax_service.py`.
  - Detects intents and routes file operations through DAX.
  - Uses deterministic UX features like Telegram inline buttons for Approvals.
  - Supports auto-recovery of interrupted runs on restart.

### 🟢 Execution Capabilities

- **Workspace MCP**: DAX operates with Model Context Protocol (MCP) servers locally, reading configurations to attach capabilities to execution contracts.
- **Tool Allowlisting**: Tools must match the defined contract allowlist, supporting boundaries for operations.
- **Soothsayer API**: Exposes human-readable overviews and controls for run execution.

---

## 2. What's Left (Planned & Deferred)

### 🟡 Next Immediate Priorities

1. **Soothsayer Web UI Updates**:
   - The backend now exposes reconstructed `RunState` and recovery APIs.
   - _Remaining_: The React frontend needs to consume `RunState` and show "Recovering" UX states. It must disable contract editing if the run is locked.
2. **Support `repo_analyze` through Picobot**:
   - Expand Picobot's intent matcher to trigger repository analysis, utilizing DAX's file/code indexing plugins.

### 🔴 Deferred Integrations (Infrastructure Phase)

These integrations are intentionally deferred until DAX demonstrates scale pressure:

1. **NATS / JetStream**:
   - _Status_: Not Started.
   - _Purpose_: Replacing HTTP polling with robust publish/subscribe transport for distributed architectures.
2. **FastMCP Integration**:
   - _Status_: Not Started.
   - _Purpose_: Extending DAX's HTTP API as a FastMCP compatible layer.
3. **GitHub CI Integration**:
   - _Status_: Documented, but not fully productized.
   - _Purpose_: Embedding DAX directly in GitHub Actions as a safety/approval gate.
4. **ZITADEL / Infisical**:
   - _Status_: Not Started.
   - _Purpose_: Auth and secret management for production deployments.

---

## Summary

The **Architecture Phase** is officially completed. The engine guarantees deterministic workflow tracking and replay. Our current phase is **Validation & UI Externalization**. Once Soothsayer fully utilizes the deterministic recovery states, we will cautiously resume adding infrastructure integrations.
