# DAX Architecture

## Product Principle

DAX is the execution control plane for AI-assisted SDLC.

In the wider `MYAIAGENTS` workspace, DAX is the execution layer.
`workspace-mcp` is the kernel/policy contract owned outside this repo, and Soothsayer is the multi-user platform layer that may integrate DAX and MCP as clients.

Core contract (RAO):

- Run: propose or execute the smallest useful action.
- Audit: evaluate permission, safety, and policy impact.
- Override: require human approval for protected actions.

## Execution Model

DAX uses an **Event-Driven Lifecycle & Projection Model**. 

The system of record is an immutable stream of **RunEvents**. The workstation (TUI) consumes a **ProjectedRun** derived from this stream, ensuring that the UI is always a reflection of the canonical execution trace.

See [DAX Event-Driven Lifecycle & Projection Model](./DAX_EVENT_DRIVEN_LIFECYCLE.md) for the definitive technical guide.

## System Layers

1. Interface Layer (CLI/TUI)
   - Accepts user requests.
   - Renders **Projected workstation views** (narrative, diffs, interventions).
2. Session Runtime
   - Emits canonical **RunEvents** during execution.
   - Manages model selection and tool orchestration.
3. Governance Layer (RAO)
   - Evaluates permission policy and emits **approval.requested** events.
   - Manages intervention surfaces for operational pauses.
4. Projection Layer
   - Transforms raw event streams into high-signal workstation models.
   - Derives speculative previews and operational narrative.
5. Tool Layer
   - Implements structured actions (read/write/shell/etc).
   - Integrates with the event stream via execution results.
6. Storage Layer
   - Event log (immutable spine).
   - Session snapshots (optimized replay).
   - Auth and project state.

## Execution Flow

1. User submits request in TUI/CLI.
2. Runtime assembles context + system instructions.
3. Provider auth preflight validates selected provider mode.
4. Model stream begins (thinking/exploring/planning/executing/verifying).
5. Tool call is proposed and checked by RAO policy.
6. If approved, tool executes and emits structured result.
7. Runtime records outputs, diffs, and telemetry.
8. Session completes with a recorded execution trace.

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
- Structured audit trail for tool calls, approvals, and outputs.
- Per-project state isolation.
- Recorded tool results, diffs, and snapshots for replay and review.

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
- Human-readable execution trace with rich review surfaces.
- Multi-provider auth diagnostics and preflight validation.
