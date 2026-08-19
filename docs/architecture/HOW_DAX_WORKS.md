---
title: How DAX Works
archetype: architecture
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - overview
last_reviewed: 2026-08-19
---

# How DAX Works

A visual overview of DAX's internals. For deeper details, see the [full architecture docs](./ARCHITECTURE.md) and [execution model](./DAX_EXECUTION_MODEL.md).

## The Complete Flow

```mermaid
graph TB
    subgraph "Input"
        User[You]
        Intent[Intent<br/>"fix this bug"]
    end

    subgraph "Governance Engine"
        Contract[Contract<br/>compilation]
        Risk[Risk<br/>assessment]
        Approval[Approval<br/>gate]
    end

    subgraph "Execution"
        Plan[Plan<br/>build]
        Steps[Execute<br/>steps]
        Tools[Tools<br/>run]
    end

    subgraph "Output"
        Artifacts[Artifacts<br/>produced]
        Audit[Audit<br/>trust score]
        EventLog[Event<br/>log]
    end

    User -->|"type"| Intent
    Intent --> Contract
    Contract --> Risk
    Risk -->|"low"| Plan
    Risk -->|"medium/high"| Approval
    Approval -->|"approved"| Plan
    Plan --> Steps
    Steps --> Tools
    Tools --> Artifacts
    Steps --> EventLog
    Artifacts --> Audit
    EventLog --> Audit

    style Contract fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style Risk fill:#e8a838,stroke:#c07d1a,color:#fff
    style Approval fill:#e85d5d,stroke:#a33,color:#fff
    style EventLog fill:#5cb85c,stroke:#3d8b3d,color:#fff
```

## 1. Intent

An intent is a natural-language description of what you want done.

DAX classifies the intent into a **workflow**:

```mermaid
graph LR
    Intent[Your input] --> Classify{Intent classifier}
    Classify -->|analysis| WA[repo_analyze]
    Classify -->|draft| WB[draft_and_approve]
    Classify -->|review| WC[review_and_signoff]
    Classify -->|general| WD[generic]

    style WA fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style WB fill:#5cb85c,stroke:#3d8b3d,color:#fff
    style WC fill:#f0ad4e,stroke:#c07d1a,color:#fff
    style WD fill:#999,stroke:#666,color:#fff
```

The workflow determines which contract DAX builds and which approval gates apply.

## 2. Contract Compilation

A **contract** is a compiled set of rules for a specific run. It defines:

- which tools the run can use
- which files the run can access
- what risk level the run operates at
- which actions require approval

```mermaid
graph TB
    Intent --> ContractEngine[Contract<br/>compiler]
    ContractEngine --> Rules[Policy rules]
    Rules --> Tools{Allowed tools?}
    Rules --> Files{Allowed paths?}
    Rules --> Risk{Risk level?}
    Tools --> ContractDoc[Contract document]
    Files --> ContractDoc
    Risk --> ContractDoc

    style ContractEngine fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style ContractDoc fill:#e8a838,stroke:#c07d1a,color:#fff
```

Once compiled, the contract **cannot change** during the run. If the AI tries to do something outside the contract, DAX detects a **contract mutation** and fails the run.

## 3. Risk Assessment and Approvals

Every step is evaluated for risk. DAX uses the contract's risk rules to decide:

```mermaid
stateDiagram-v2
    [*] --> Evaluate: Step proposed
    Evaluate --> Low: No file writes, no shell
    Evaluate --> Medium: File edits, safe operations
    Evaluate --> High: Deletions, shell commands, production access
    Low --> AutoExecute: Auto-approve
    Medium --> RequestApproval: Show preview, ask
    High --> RequestApproval: Block until approved
    RequestApproval --> Approved: Human says yes
    RequestApproval --> Denied: Human says no
    AutoExecute --> Execute
    Approved --> Execute
    Denied --> Skip

    style RequestApproval fill:#e85d5d,stroke:#a33,color:#fff
    style AutoExecute fill:#5cb85c,stroke:#3d8b3d,color:#fff
```

## 4. Execution with Tools

DAX uses **tools** to take real actions. Each tool is scoped and governed:

| Tool       | What it does  | Risk   |
| ---------- | ------------- | ------ |
| `read`     | Read a file   | Low    |
| `glob`/`grep`/`codesearch` | Search code | Low |
| `edit`/`write`/`apply_patch` | Modify a file | Medium |
| `shell`    | Run a command | High   |
| `webfetch`/`websearch` | Fetch a URL | Medium |

> Tool ids are simplified here for a visual overview. The canonical classification is in
> `packages/dax/src/tool/tool-class.ts:24-30` (`EDIT_TOOL_IDS`, `SHELL_TOOL_IDS`, `READ_TOOL_IDS`).

```mermaid
graph LR
    AI[AI proposes tool] --> Check{Contract<br/>check}
    Check -->|Allowed| Gate{Approval<br/>needed?}
    Check -->|Denied| Fail[Contract mutation]
    Gate -->|No| Run[Tool runs]
    Gate -->|Yes| Ask[Ask operator]
    Ask -->|Approved| Run
    Ask -->|Denied| Skip[Skip step]
    Run --> Result[Structured result]

    style Fail fill:#e85d5d,stroke:#a33,color:#fff
    style Run fill:#5cb85c,stroke:#3d8b3d,color:#fff
    style Result fill:#4a90d9,stroke:#2c5f8a,color:#fff
```

## 5. Event Log

Every action DAX takes is recorded in an **event log**. This is the foundation for:

- **Audit** — review what happened
- **Replay** — reconstruct what the AI did
- **Recovery** — resume after a crash
- **Accountability** — prove what was done

```mermaid
graph TB
    subgraph "Events Recorded"
        E1[run.created]
        E2[run.started]
        E3[step.proposed]
        E4[step.started]
        E5[approval.requested]
        E6[approval.resolved]
        E7[step.completed]
        E8[run.completed]
    end

    E1 --> E2 --> E3 --> E4
    E4 --> E5 --> E6 --> E7 --> E8

    E8 -->|Stored| Log[Event log]
    Log --> Replay[Replay]
    Log --> Recovery[Recovery]
    Log --> Audit[Audit]
```

Events can also be published to **NATS/JetStream** for external consumption (Soothsayer, dashboards, integrations).

## 6. Replay and Recovery

**Replay** reads the event log and reconstructs the run state at any point in time.

**Recovery** reads the event log, finds the last known good state, and resumes from there.

```mermaid
graph LR
    subgraph "Replay"
        Log1[Event log] --> Replay1[Reconstruct<br/>state at time T]
    end
    subgraph "Recovery"
        Log2[Event log] --> Find[Find last<br/>good state]
        Find --> Resume[Resume<br/>execution]
    end
    style Replay1 fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style Resume fill:#5cb85c,stroke:#3d8b3d,color:#fff
```

## 7. System Map

```mermaid
mindmap
  root((DAX))
    CLI/TUI
      Commands
      Workstation
    Session Runtime
      Provider selection
      Message building
      Stream processing
    Governance
      Contract compilation
      Risk assessment
      Approval gates
      Contract mutation detection
    Tools
      read / search / edit
      shell / web / task
    State Machine
      created → compiled → queued
      running ↔ waiting_approval
      completed / failed / cancelled
    Event Log
      Append-only
      Deterministic replay
      Crash recovery
    External Surface
      FastMCP substrate
      NATS transport
      Infisical secrets
      ZITADEL identity
      OpenTelemetry observability
```

## Further Reading

- [Full Architecture](./ARCHITECTURE.md) — system layers and runtime components
- [Execution Model](./DAX_EXECUTION_MODEL.md) — lifecycle, objects, and interfaces
- [Trust Model](./DAX_TRUST_MODEL.md) — evidence-based trust and safety
- [Stack Roadmap](../OPEN_SOURCE_STACK_ROADMAP.md) — integration phases and infrastructure
