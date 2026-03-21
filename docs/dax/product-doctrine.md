# DAX Product Doctrine

## Core Thesis

DAX is the **execution authority**. It is not a chat interface with good manners. It is not an autonomous coding agent that happens to ask permission sometimes. It is a governed execution system that produces deterministic, auditable, replayable outcomes.

---

## First Principles

### 1. DAX is the workflow authority

Every execution flows through DAX. DAX owns:

- Task compilation
- State transitions
- Approval gates
- Artifact production
- Trust evaluation

External systems (Picobot, Soothsayer, LLMs) are inputs and observers, not co-authorities.

### 2. Sessions are runtime containers, not primary truth

A session is a container for execution context. It is not the source of truth for:

- Run status
- Step progress
- Approval state
- Trust posture

Truth lives in:

- `RunState` (persisted state machine)
- `ExecutionContract` (compiled task definition)
- `ApprovalRecord` (canonical approval objects)
- `RunEvent[]` (ordered event log)

Session signals (messages, tool calls, permissions) are inputs to truth derivation, not truth itself.

### 3. Approvals are workflow objects, not incidental permission popups

An approval in DAX is:

- First-class: has id, step, risk, context, consequence
- Persisted: lives in `RunState.approvals`
- Transitioned: moves through `pending → approved/denied/expired`
- Auditable: resolution includes actor, reason, timestamp

Permission intercepts are one source of approvals. Workflow definitions are another. Both converge on the same `Approval` object.

### 4. "Deterministic" means bounded, authored, replayable transitions

DAX does not claim perfect model output determinism. It claims:

- **Bounded**: tool access is allowlisted, resources are metered
- **Authored**: execution follows a compiled contract, not freeform prompting
- **Replayable**: same contract + same inputs → recoverable state graph
- **Transition-based**: state changes are explicit events, not inferred from archaeology

### 5. The execution contract precedes execution

```
Intent → ExecutionContract → RunState → Execution → Artifact
```

Intent comes in. ExecutionContract is compiled. RunState is initialized. Execution proceeds through authored transitions. Artifact is produced.

The model never receives raw intent text as a prompt first.

---

## Architectural Commitments

### What DAX owns

- Execution contract compilation
- Run state machine (authoritative)
- Approval lifecycle (canonical)
- Event log (append-only)
- Artifact registry
- Trust evaluation
- Determinism test harness

### What DAX delegates

- **LLM inference**: model is a tool, not the runtime
- **Tool execution**: via plugin registry and MCP
- **Message transport**: via NATS when added
- **Secret management**: via Infisical when added
- **Identity/auth**: via ZITADEL when added
- **UI/ingress**: via Picobot, TUI, Soothsayer

### What DAX rejects

- Model-as-controller: LLM does not own state transitions
- Chat-first design: conversations are inputs, not the product
- Inferred truth: lifecycle derivation is reconciliation, not primary path
- Permission-as-approval: permission popups are one signal, not the approval model

---

## Execution Guarantee Levels

| Level | Name              | Guarantee                                            |
| ----- | ----------------- | ---------------------------------------------------- |
| D0    | Inspectable       | Output is logged, not guaranteed                     |
| D1    | Bounded           | Tool access is allowlisted, resources metered        |
| D2    | Approval-Gated    | Explicit pauses with human decision                  |
| D3    | Compiled Workflow | Fixed step graph, full replay, deterministic outputs |

DAX targets D3 for authored workflows. External intent-first runs operate at D1-D2.

---

## Runtime Truth Hierarchy

```
1. RunState (persisted, authoritative)
2. ExecutionContract (compiled, immutable for run lifetime)
3. RunEvent[] (append-only log, replayable)
4. Session (runtime container, signals input only)
5. Messages/Tools (execution traces, not truth)
```

Snapshot reads from 1. Lifecycle inference reconciles 1+4 when needed.

---

## Compatibility Commitment

New deterministic architecture does not rewrite legacy session assumptions at once.

Migration path:

1. Compatibility adapters wrap legacy signals
2. Adapters emit canonical events into new model
3. Reconciliation logic handles edge cases
4. Legacy paths deprecated once coverage is complete

Adapters live in `packages/dax/src/runtime/compat/`.

---

## Summary

DAX is:

> **The bounded, authored, approval-aware execution authority that produces deterministic, replayable, auditable outcomes.**

DAX is not:

- A chat interface with governance
- An autonomous agent that asks nicely
- A prompt template system
- A model wrapper

This doctrine is the frame. The spec defines the contract. The implementation makes it real.
