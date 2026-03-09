# DAX Architecture

## Product Principle

DAX is a policy-driven execution system for software delivery.

In the wider `MYAIAGENTS` workspace, DAX is the execution layer.
`workspace-mcp` is the kernel/policy contract owned outside this repo, and Soothsayer is the multi-user platform layer that may integrate DAX and MCP as clients.

Core contract (RAO):

- Run: propose or execute the smallest useful action.
- Audit: evaluate safety, scope, and policy impact.
- Override: require human approval for protected actions.

## System Layers

1. Interface Layer (CLI/TUI)
   - Accepts user requests.
   - Renders stream stages, diffs, approvals, and status.
2. Session Runtime
   - Builds prompts/messages.
   - Selects provider/model.
   - Streams model output and tool calls.
3. Governance Layer (RAO)
   - Applies policy to commands/tools/filesystem actions.
   - Produces allow/ask/deny decisions.
4. Tool Layer
   - Read/search/edit/patch/shell/web/task tools.
   - Structured inputs/outputs for traceability.
5. Storage Layer
   - Session messages and parts.
   - Auth state.
   - Project memory and approvals.

## Execution Flow

1. User submits request in TUI/CLI.
2. Runtime assembles context + system instructions.
3. Provider auth preflight validates selected provider mode.
4. Model stream begins (thinking/exploring/planning/executing/verifying).
5. Tool call is proposed and checked by RAO policy.
6. If approved, tool executes and emits structured result.
7. Runtime records outputs, diffs, and telemetry.
8. Session completes with deterministic trace.

## Provider Orchestration Model

- `google/*`:
  - Gemini API auth path (OAuth/API key).
- `google-vertex/*` and `google-vertex-anthropic/*`:
  - Vertex auth path (ADC + project).

DAX intentionally enforces this split to avoid token-type mismatch.

## Key Runtime Components

- Provider loader/registry:
  - Discovers providers/models/options.
- Message/stream processor:
  - Converts streamed deltas into durable parts.
  - Handles retries and error mapping.
- Prompt subsystem:
  - Maintains input state/history/stash/autocomplete.
  - Preserves lifecycle across route/pane transitions.
- Theme/UX subsystem:
  - Provides real-time theme updates and status panes.

## Safety Properties

- Explicit human approvals for high-risk actions.
- Structured audit trail for tool calls and outputs.
- Per-project state isolation.
- Deterministic tool result recording (including diffs and snapshots).

## Module Map

- `packages/dax/src/session/*`
- `packages/dax/src/provider/*`
- `packages/dax/src/cli/cmd/*`
- `packages/dax/src/cli/cmd/tui/*`
- `packages/dax/src/tool/*`
- `packages/dax/src/project/*`
- `packages/dax/src/auth/*`

## Repo Boundary

The canonical shipped DAX product lives in `packages/dax`.
Older root-level scaffold paths such as `cli/`, `core/`, `tui/`, and `script/build.ts` are quarantined legacy material and are not the source of truth for new work.

## Non-Goals

- Chat-only assistant behavior without guardrails.
- Hidden side effects outside audited execution paths.

## Distinctive Features

- RAO approvals integrated into runtime, not bolted on.
- Tool-first deterministic tracing with rich status panes.
- Multi-provider auth diagnostics and preflight validation.
