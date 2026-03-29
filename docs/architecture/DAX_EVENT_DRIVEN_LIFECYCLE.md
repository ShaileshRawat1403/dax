# DAX Event-Driven Lifecycle & Projection Model

## 1. Architectural Vision

DAX has transitioned from a property-based state model to a **canonical event-driven lifecycle**. 

In this model, the system of record is an immutable sequence of **RunEvents**. The user-facing workstation (TUI/API) does not read from a primary "session database"; instead, it consumes a **ProjectedRun** derived from the event stream.

## 2. The Core Pipeline

1. **Emission**: The DAX Runtime (and legacy adapters) emit strongly-typed `RunEvent` objects to a durable store.
2. **Snapshotting**: Periodic `RunSnapshot` objects capture the summary state to optimize replay.
3. **Projection**: The Projection Layer (`run-projections.ts`) transforms the event stream into high-signal workstation views.
4. **Consumption**: The Workstation (TUI) renders the projection, ensuring high situational awareness for the operator.

## 3. Canonical Event Language

The lifecycle is defined by a set of strictly discriminated events:

- `run.created` / `run.started` / `run.completed` / `run.failed`: High-level session boundaries.
- `intent.created`: Captures the operator's goal and target.
- `plan.compiled`: Records the strategy and task graph.
- `step.proposed` / `step.started` / `step.completed` / `step.failed`: Granular execution tracking.
- `approval.requested` / `approval.resolved`: Governance gates.
- `artifact.created`: Evidence production.
- `audit.posture_updated`: Trust and policy findings.
- `intervention.required` / `intervention.resolved`: Operational pauses for ambiguity or recovery.

## 4. The Projection Layer

Projections are pure functions that transform `(Snapshot, Events[])` into a workstation-ready model.

### 4.1. Narrative Projection
Collapses internal technical noise into a human-readable, operational feed. It uses pre-computed `message` fields from the events to ensure the TUI remains fast and reactive.

### 4.2. Intervention Surface
Derives active operational blocks from the event stream. Interventions are unique, trackable entities (`requested` -> `resolved`) that identify exactly why a run is paused.

### 4.3. Speculative Preview (Proposed Changes)
Derives a "proposed write surface" by scanning pending `approval.requested` events for `diffPreview` context. This allows operators to review exactly what will happen before granting permission.

## 5. Replay & Compatibility

DAX maintains backward compatibility through **Replay Adapters**.

- **Legacy Events**: Retired events like `trust.updated` are handled in `replayRunState` via narrowed type casts, ensuring old sessions still reconstruct correctly.
- **Permission Mapping**: The `PermissionAdapter` maps legacy `permission.asked` events into canonical `approval.requested` events, including speculative diff extraction.

## 6. System of Record

- **Source of Truth**: The Event Log.
- **Access Pattern**: `RunGateway.getProjections(runId)`.
- **Validation**: Strict Zod schemas in `run-contract.ts` enforce the execution language.

## 7. Operational Benefits

- **Auditability**: Every change in state is traceable to a specific event and timestamp.
- **Resumability**: Replaying the event stream reconstructs the exact runtime state (`RunState`).
- **Signal Density**: The projection layer filters low-level telemetry into high-signal operator notifications.
- **Decoupling**: The UI can evolve its presentation logic independently of the underlying execution engine.
