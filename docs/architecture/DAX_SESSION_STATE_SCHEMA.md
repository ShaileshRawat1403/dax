# Architecture: DAX Session State Schema

## 1. Purpose

This document defines the structured session state schema for DAX. This schema serves as the "operational memory spine" for the platform, capturing the full context of an execution session.

The goal is to move beyond simple chat history to a structured, queryable state that supports:

- **Resumability**: Ability to pause and resume any session.
- **Governance**: Tracking trust, approvals, and artifacts.
- **Intelligence**: Rolling summaries and context-aware retrieval.
- **Persistence**: A clean separation between short-term and long-term memory.

## 2. Core Types

The session state is built around these fundamental concepts.

### 2.1. Finding

A validated piece of information discovered during execution.

```ts
interface Finding {
  id: string
  type: "code_smell" | "dependency_issue" | "architectural_boundary" | "test_gap" | "security_risk" | "docs_gap"
  severity: "critical" | "major" | "minor" | "info"
  title: string
  description: string
  evidence: string[] // Paths to files or specific code snippets
  confirmed: boolean
  timestamp: string
}
```

### 2.2. Hypothesis

A working assumption that is being tested or explored.

```ts
interface Hypothesis {
  id: string
  statement: string
  status: "testing" | "validated" | "rejected" | "pending"
  relatedFindings?: string[] // IDs of findings
  timestamp: string
}
```

### 2.3. OpenQuestion

A question that requires human input or further investigation.

```ts
interface OpenQuestion {
  id: string
  question: string
  context: string // Why this question is important
  priority: "high" | "medium" | "low"
  status: "unanswered" | "answered" | "dismissed"
  answer?: string
  timestamp: string
}
```

### 2.4. Risk

A potential issue identified during execution.

```ts
interface Risk {
  id: string
  description: string
  likelihood: "high" | "medium" | "low"
  impact: "high" | "medium" | "low"
  mitigation?: string
  status: "identified" | "mitigated" | "accepted"
  timestamp: string
}
```

### 2.5. NextAction

A recommended next step for the session.

```ts
interface NextAction {
  id: string
  description: string
  rationale: string // Why this is the next best action
  dependencies: string[] // Artifacts or findings required
  status: "pending" | "in_progress" | "completed" | "skipped"
  timestamp: string
}
```

### 2.6. EmittedArtifact

Reference to an artifact generated during the session.

```ts
interface EmittedArtifact {
  id: string
  type: string // e.g., 'report', 'map', 'graph'
  name: string
  path: string
  description: string
  producedBy: string // Operator or Skill ID
  timestamp: string
}
```

### 2.7. TrustState

The current trust posture of the session.

```ts
interface TrustState {
  score: number // 0.0 to 1.0
  posture: "trusted" | "neutral" | "untrusted"
  signals: {
    source: string // e.g., 'operator_id', 'policy_check'
    delta: number
    reason: string
  }[]
  lastUpdated: string
}
```

### 2.8. ApprovalState

The status of any governance approvals.

```ts
interface ApprovalState {
  pending: {
    requestId: string
    reason: string
    requestedAt: string
  }[]
  granted: {
    requestId: string
    grantedBy: string
    grantedAt: string
  }[]
  denied: {
    requestId: string
    deniedBy: string
    deniedAt: string
    reason: string
  }[]
}
```

## 3. Session State Structure

The root object representing the entire state of a DAX session.

```ts
interface SessionState {
  id: string
  status: "active" | "paused" | "completed" | "abandoned"

  // Context
  currentGoal?: string
  workflowId?: string // If running a workflow
  workspace: {
    cwd: string
    repo?: string
  }

  // Intelligence
  findings: Finding[]
  hypotheses: Hypothesis[]
  openQuestions: OpenQuestion[]
  risks: Risk[]
  nextActions: NextAction[]
  completedSteps: string[]

  // Governance & Evidence
  emittedArtifacts: EmittedArtifact[]
  trustState: TrustState
  approvalState: ApprovalState

  // Metadata
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

## 4. Rolling Session Summary

To keep the LLM context clean and efficient, the session state should generate a rolling summary.

```ts
interface SessionSummary {
  sessionId: string
  status: "active" | "paused" | "completed"

  // One-paragraph summary of current status
  narrative: string

  // Key metrics
  findingsCount: number
  artifactsCount: number
  trustScore: number

  // Top priorities
  topRisks: Risk[]
  nextBestActions: NextAction[]
  openQuestions: OpenQuestion[]
}
```

## 5. Memory Candidate

For future long-term memory (RAG), candidates are extracted from the session state.

```ts
interface MemoryCandidate {
  id: string
  sessionId: string
  type: "finding" | "risk" | "artifact_summary" | "hypothesis"
  content: string
  importance: number // 0.0 to 1.0
  embeddableContent: string // Text optimized for vector embedding
  timestamp: string
}
```

## 6. Proposed Directory Structure

This schema would live in:

```
packages/dax/src/session/
  state.ts          # Core types (SessionState, Finding, etc.)
  store.ts          # Session state persistence logic
  summary.ts        # Logic to generate rolling summaries
  memory.ts         # Logic to extract memory candidates
```

And for future long-term memory:

```
packages/dax/src/memory/
  types.ts          # MemoryCandidate
  embed.ts          # Embedding generation
  retrieval.ts      # Retrieval logic
```

## 7. Summary

This schema provides DAX with a powerful operational memory. It captures not just the chat history, but the structured output of the execution—findings, artifacts, trust, and risks. This is the foundation required for the platform to be reliable, resumable, and intelligent.
