# What Is DAX?

DAX stands for **Deterministic AI eXecution**. It is a governed execution control plane for AI-assisted software development.

## What It Is

DAX is not a chatbot. It is an **execution engine** that takes a natural-language intent, builds a concrete execution plan, and carries it out — with human oversight at every step.

```mermaid
graph LR
    A[Your Intent<br/>in words] --> B[DAX Engine]
    B --> C[Plan]
    C --> D[Run]
    D --> E[Artifact]
    E --> F[Audit]
    B -->|governed by| G[Contract<br/>Governance]
    G -->|asks you| H[Approval]
    style A fill:#f0f0f0,stroke:#333
    style B fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style G fill:#e8a838,stroke:#c07d1a,color:#fff
    style H fill:#e85d5d,stroke:#a33,color:#fff
```

## What Problem It Solves

AI agents can generate code, run commands, and touch your filesystem. Without structure, that means:

- no visibility into what the agent actually did
- no audit trail for compliance
- no way to stop a runaway agent before it damages something
- no recovery when something goes wrong midway

DAX replaces free-running autonomy with **governed execution** — every action is recorded, every risky step requires approval, and the entire history can be replayed.

## One-Line Positioning

**DAX is the governed execution workstation for AI-driven software work, giving teams approvals, replayability, and audit-grade control instead of black-box agent behavior.**

## Who It Is For

| Role          | What DAX Gives You                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Developer** | A terminal workstation that runs AI tasks with full transparency, approval gates, and replay            |
| **Tech lead** | A governance surface to review what the AI did, approve/deny risky actions, and audit execution history |
| **Team**      | A shared contract that makes AI behavior predictable and reviewable                                     |

## The RAO Model

DAX operates on a three-phase loop called **RAO**:

```mermaid
graph TB
    R[Run] --> A[Audit]
    A --> O[Override]
    O --> R
    style R fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style A fill:#e8a838,stroke:#c07d1a,color:#fff
    style O fill:#e85d5d,stroke:#a33,color:#fff
```

1. **Run** — The model proposes a technical action or plan.
2. **Audit** — Automated permission rules and safety gates evaluate the action.
3. **Override** — A human operator reviews, allows, or denies the decision.

This loop runs for every significant step. Nothing touches your codebase without going through it.

## Where DAX Sits

DAX is one piece of a larger ecosystem:

```mermaid
graph TB
    subgraph "Ingress Layer"
        P[Picobot<br/>WhatsApp / Telegram]
    end
    subgraph "Execution Layer"
        D[DAX<br/>Governed Engine]
    end
    subgraph "Operator Plane"
        S[Soothsayer<br/>Web Dashboard]
    end
    subgraph "Shared Kernel"
        W[Workspace MCP<br/>Policy & Capabilities]
    end
    subgraph "Infrastructure"
        N[NATS/JetStream<br/>Events]
        I[Infisical<br/>Secrets]
        Z[ZITADEL<br/>Identity]
        O[OpenTelemetry<br/>Observability]
    end

    P -->|intent| D
    S -->|observe, approve| D
    D -->|events| N
    I -.->|creds| D
    Z -.->|JWT| D
    O -.->|traces| D
    D -->|uses| W

    style D fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style S fill:#7b68ee,stroke:#5a4bb8,color:#fff
    style P fill:#5cb85c,stroke:#3d8b3d,color:#fff
    style W fill:#f0ad4e,stroke:#c07d1a,color:#fff
```

## What DAX Is Not

- **Not a coding assistant** — DAX does not chat about code. It executes governed workflows.
- **Not a black box** — Every step is recorded, auditable, and replayable.
- **Not autonomous** — Human approval gates are a core feature, not an optional add-on.

## How DAX Differs From Adjacent Tools

| Tool | Main mental model | What it does well | What DAX emphasizes instead |
| :--- | :--- | :--- | :--- |
| **Cursor** | AI coding inside the IDE | Rapid inline edits and assistance | Explicit approvals, governed execution, and run-level review |
| **Codex** | Agentic implementation runtime | Deep code generation and execution throughput | Structured run state, intervention semantics, and replayability |
| **Claude Code** | Terminal-native coding agent | Strong repo reasoning in a CLI workflow | Operator control, speculative previews, and audit-ready execution trails |
| **DAX** | Governed execution workstation | Trusted delivery flow for AI work in codebases | Delivery discipline over assistant convenience |

## Where DAX Is Heading

The product direction is becoming clearer:

- **`1.0.12`** hardens mode truthfulness, provider-neutral reflection, and real operator controls so the workstation feels more stable and less decorative in live use.
- **`1.1.x`** should deepen approvals and shared operator workflows.
- **`1.2.x`** should expand remote governance and multi-surface continuity.

## Next Steps

- **New to DAX?** Read [DAX In Simple Words](./DAX_IN_SIMPLE_WORDS.md) for analogies and a plain-language walkthrough.
- **Ready to try it?** Read [Quickstart](./QUICKSTART.md) to install and run your first workflow.
- **Want the product framing?** Read [Positioning](./POSITIONING.md) and [Roadmap](./ROADMAP.md).
- **Want to understand the internals?** Read [How DAX Works](../architecture/HOW_DAX_WORKS.md).
