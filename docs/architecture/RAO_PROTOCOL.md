# DAX RAO Protocol Specification

## Overview

The **RAO (Run, Audit, Override) Protocol** is the fundamental execution governance protocol of DAX.

While frameworks like **MCP (Model Context Protocol)** provide _access_ to tools, and **A2A (Agent-to-Agent) / ACP** provide _interoperability_ between agents, the **RAO Protocol** provides _accountability_ for stochastic agent execution.

DAX operates as the governed execution layer sitting above agents and tools.

```text
External agents and tools
        ↓
A2A / ACP / MCP adapters
        ↓
DAX RAO Protocol
        ↓
Run state, approvals, audit, recovery
        ↓
TUI projections and operator intervention
```

## Protocol Layers

DAX implements a three-layer protocol architecture:

1. **Layer 1: Tool Context Protocol (MCP / FastMCP)**
   - **Purpose:** Let DAX call tools safely.
   - **Role:** Strictly treated as an ingress adapter, decoupled from core governance.

2. **Layer 2: Agent Interop Protocol (A2A / ACP)**
   - **Purpose:** Let DAX talk to external agents.
   - **Role:** A formal adapter layer using A2A/ACP to allow arbitrary external agents to interact with DAX.

3. **Layer 3: Execution Governance Protocol (RAO Protocol / DEP)**
   - **Purpose:** Let DAX govern runs, approvals, audits, evidence, and recovery.
   - **Role:** A public, versioned API/Schema defining valid states, transitions, and evidence. Accountability is the protocol itself.

## Core RAO Protocol Objects (Draft Spec)

The RAO Protocol formalizes the DAX execution lifecycle into standard objects.

### RunRequest

Defines the intent and constraints for a run.

```typescript
interface RunRequest {
  intent: string
  scope: Scope
  actor: Actor
  riskProfile: RiskProfile
  allowedTools: ToolCapability[]
}
```

### RunState

The current state of an execution run.

```typescript
interface RunState {
  runId: string
  status: "planned" | "waiting_approval" | "running" | "blocked" | "verified" | "failed"
  currentStep: Step
  evidence: Evidence[]
}
```

### ApprovalRequest

A formal request for operator intervention.

```typescript
interface ApprovalRequest {
  approvalId: string
  runId: string
  reason: string
  proposedAction: Action
  risk: RiskLevel
  diffPreview?: Diff
}
```

### EvidenceReceipt

Cryptographic or historical proof of an action's completion and state.

```typescript
interface EvidenceReceipt {
  receiptId: string
  runId: string
  claim: string
  proof: string
  source: string
  verifiedAt: string
}
```

### OverrideDecision

An operator's response to an approval request.

```typescript
interface OverrideDecision {
  approvalId: string
  decision: "allow" | "deny" | "modify" | "persist_rule"
  operator: Actor
  reason?: string
}
```

## Strategic Implications

By formalizing RAO as a protocol rather than just internal logic:

1. **Contract over Code:** Third-party tools, auditors, or external runtimes can understand and comply with DAX's governed execution without having to run or depend on the internal DAX implementation.
2. **Pluggable Architecture:** Adding a new agent type or tool provider only requires implementing a compliant adapter that talks the RAO Protocol.
3. **Accountability as a Product:** Any agent or tool that interacts with DAX through the RAO Protocol is automatically part of the governed, auditable system.

_DAX RAO Protocol: a deterministic control protocol for stochastic agent execution._
