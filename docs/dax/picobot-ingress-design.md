# Phase 7.2: Picobot Ingress Integration Design

## Overview

This document defines the integration contract between Picobot (WhatsApp ingress) and DAX/Soothsayer (workflow execution engine).

**Design Principle**: Picobot is thin ingress only. All business logic, workflow classification, approval semantics, and trust interpretation remain in DAX. Picobot relays already-humanized output without modification.

---

## 1. Picobot Responsibilities

Picobot will:

| Responsibility          | Description                                |
| ----------------------- | ------------------------------------------ |
| **Receive messages**    | Accept user text from WhatsApp             |
| **Normalize requests**  | Extract intent from natural language       |
| **Call DAX API**        | Start DAX runs via Soothsayer API          |
| **Relay progress**      | Forward workflow status updates            |
| **Relay approvals**     | Surface approval requests to user          |
| **Relay final results** | Return completed workflow output           |
| **Handle errors**       | Surface DAX errors in user-friendly format |

Picobot will NOT:

| Non-Responsibility         | Reason                                       |
| -------------------------- | -------------------------------------------- |
| No workflow classification | DAX determines workflow class from intent    |
| No approval semantics      | DAX provides human-readable approval context |
| No trust interpretation    | DAX provides trust posture labels            |
| No presentation rewriting  | Soothsayer provides presentation-safe output |

---

## 2. Message Flow

```
User (WhatsApp)
    │
    ▼
Picobot: Receive message
    │
    ▼
Picobot: Normalize request → Extract intent
    │
    ▼
DAX API: SoothsayerAPI.createRun()
    │
    ▼
{ runId, status, createdAt }
    │
    ├──────────────────────────────────────┐
    │                                      │
    ▼                                      ▼
DAX: Execute workflow              Picobot: Store runId
    │                                      │
    ├──────────────────────────────────────┤
    ▼                                      ▼
[Status: waiting_approval]    Picobot: Poll/Subscribe
    │                                      │
    ├──────────────────────────────────────┤
    ▼                                      ▼
DAX: SoothsayerAPI.getApprovalQueue()
    │                                      │
    ▼                                      ▼
Picobot: Format approval prompt        ────┘
    │
    ▼
User: Approve/Deny
    │
    ▼
Picobot: SoothsayerAPI.resolveApproval()
    │
    ▼
[Status: running → completed/failed]
    │
    ▼
Picobot: Poll final status
    │
    ▼
Picobot: Format and relay final result
    │
    ▼
User (WhatsApp)
```

---

## 3. Minimal First Workflow: `draft_and_approve`

For Phase 7.2, Picobot will support only `draft_and_approve` workflow.

### Why `draft_and_approve`?

- Intent is clear: user wants to draft something and get approval before execution
- Natural language maps well: "create X", "write Y", "generate Z"
- Manual approval matches WhatsApp async nature
- Minimal blast radius for first integration

### Supported Intent Patterns

| User Input                | Interpretation                        |
| ------------------------- | ------------------------------------- |
| "create a script that..." | draft_and_approve                     |
| "write code for..."       | draft_and_approve                     |
| "generate a report on..." | draft_and_approve                     |
| "analyze the codebase"    | ❌ Not supported (repo_analyze)       |
| "review this PR"          | ❌ Not supported (review_and_signoff) |

### Intent Classification

Picobot uses simple keyword matching (not ML):

```python
DRAFT_PATTERNS = [
    "create", "write", "generate", "make", "build",
    "implement", "add", "modify", "refactor", "fix"
]

def classify_intent(message: str) -> str | None:
    text = message.lower()
    if any(p in text for p in DRAFT_PATTERNS):
        return "draft_and_approve"
    return None  # Unknown workflow
```

---

## 4. API Contract

### 4.1 Create Run

**Endpoint**: `SoothsayerAPI.createRun()` (via DAX internal)

**Picobot Request**:

```python
{
    "intent": {
        "input": "<user message>",
        "kind": "workflow_step"
    },
    "metadata": {
        "source": "picobot",
        "chatId": "<whatsapp chat id>",
        "initiatedBy": "<user phone number>"
    }
}
```

**DAX Response**:

```python
{
    "runId": "run_abc123",
    "status": "created",
    "createdAt": "2026-03-21T12:00:00Z"
}
```

### 4.2 Get Run Detail

**Endpoint**: `SoothsayerAPI.getRunDetail(runId)`

**DAX Response** (presentation-safe):

```python
{
    "runId": "run_abc123",
    "status": "running",
    "title": "Create backup script",
    "progress": {
        "currentStep": "prepare_draft",
        "currentStepLabel": "Prepare Draft",
        "currentStepDescription": "Generate or prepare the draft artifact for review",
        "totalSteps": 3,
        "percentage": 33
    },
    "workflow": {
        "class": "draft_and_approve",
        "classLabel": "Draft & Approve",
        "classDescription": "Generate a draft and request approval before execution",
        "trustPosture": "medium",
        "trustPostureLabel": "Medium Trust"
    },
    "trust": {
        "posture": "guarded",
        "postureLabel": "Guarded",
        "blocked": false
    },
    "approvals": {
        "pending": 0,
        "approved": 0,
        "denied": 0
    }
}
```

### 4.3 Get Approval Queue

**Endpoint**: `SoothsayerAPI.getApprovalQueue(runId)`

**DAX Response** (presentation-safe):

```python
[
    {
        "approvalId": "apr_xyz789",
        "runId": "run_abc123",
        "type": "file_write",
        "typeLabel": "File Write",
        "typeIcon": "file-edit",
        "status": "pending",
        "risk": "medium",
        "riskLabel": "Medium Risk",
        "riskSeverity": 2,
        "riskColor": "yellow",
        "title": "Write to: scripts/backup.sh",
        "titleEnriched": "Write to: scripts/backup.sh",
        "reason": "File modification detected",
        "context": {
            "filePath": "scripts/backup.sh"
        },
        "whatHappensNext": {
            "afterApprove": "Write changes will be applied to scripts/backup.sh.",
            "afterDeny": "File write will be skipped."
        },
        "createdAt": "2026-03-21T12:05:00Z"
    }
]
```

### 4.4 Resolve Approval

**Endpoint**: `SoothsayerAPI.resolveApproval(runId, approvalId, decision, actorId)`

**Picobot Request**:

```python
{
    "decision": "approve",  # or "deny"
    "actorId": "<user phone number>"
}
```

**DAX Response**:

```python
{
    "approvalId": "apr_xyz789",
    "status": "approved",
    "resolution": {
        "decision": "approve",
        "actorId": "<user phone number>",
        "source": "soothsayer"
    },
    "resolvedAt": "2026-03-21T12:10:00Z"
}
```

---

## 5. Picobot Message Formats

### 5.1 Run Started

```
🤖 *Draft & Approve* started

Your request is being processed. I'll notify you when approval is needed.
```

### 5.2 Approval Request

```
⚠️ *Approval Required*

*Type*: File Write
*Risk*: Medium Risk

📄 Write to: `scripts/backup.sh`

*What happens after approval:*
Write changes will be applied to scripts/backup.sh.

---

Reply with:
• `approve` - to proceed
• `deny` - to cancel
```

### 5.3 Approval Granted

```
✅ *Approved*

Your request is now being executed.
```

### 5.4 Approval Denied

```
❌ *Denied*

Your request has been cancelled.
```

### 5.5 Workflow Completed

```
✅ *Completed*

*Draft & Approve* finished successfully.

📋 Check your files for the changes.
```

### 5.6 Workflow Failed

```
❌ *Failed*

*Draft & Approve* encountered an error.

Reason: [terminal reason label]
```

---

## 6. Failure Paths

### 6.1 Run Creation Fails

| Scenario          | User Message                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- |
| DAX unavailable   | "Sorry, the service is temporarily unavailable. Please try again later."           |
| Invalid intent    | "I couldn't understand your request. Try saying 'create', 'write', or 'generate'." |
| Permission denied | "You don't have permission to start workflows. Contact your administrator."        |

### 6.2 Approval Expires

| Scenario        | User Message                                                    |
| --------------- | --------------------------------------------------------------- |
| Timeout (5 min) | "⏰ Approval request expired. The workflow has been cancelled." |

### 6.3 Run Fails

| Scenario          | User Message                                    |
| ----------------- | ----------------------------------------------- |
| Execution error   | "❌ Workflow failed: [error message]"           |
| Permission denied | "❌ Workflow blocked: insufficient permissions" |
| Timeout           | "❌ Workflow timed out"                         |

### 6.4 Transport Interruption

| Scenario                 | Recovery                                                 |
| ------------------------ | -------------------------------------------------------- |
| WhatsApp webhook timeout | DAX continues; user polls or receives async notification |
| Picobot restart          | Pending runs tracked by runId; resume on restart         |

---

## 7. Polling vs. Subscription

For Phase 7.2, use **polling** with exponential backoff:

```python
POLL_INTERVALS = [
    (0, 5),      # 0-5s: poll every 2s
    (5, 30),     # 5-30s: poll every 5s
    (30, 300),   # 30s-5min: poll every 15s
    (300, None), # 5min+: poll every 60s
]

async def poll_status(run_id: str, on_update: Callable):
    elapsed = 0
    while True:
        detail = await soothsayer.get_run_detail(run_id)
        await on_update(detail)

        if detail.status in ("completed", "failed", "cancelled"):
            break

        interval = get_interval(elapsed, POLL_INTERVALS)
        await asyncio.sleep(interval)
        elapsed += interval
```

Future: Use `SoothsayerAPI.subscribeToRun()` for WebSocket-based push.

---

## 8. File Structure

```
picobot/
├── agent/
│   └── tools/
│       └── dax.py          # NEW: DAX tool for Picobot
├── bus/
│   └── dax_integration.py  # NEW: DAX event handlers
└── config/
    └── dax.py             # NEW: DAX configuration

dax/packages/dax/src/
├── soothsayer/
│   └── soothsayer-api.ts  # Already exists
└── picobot/
    └── picobot-client.ts   # NEW: HTTP client for Picobot
```

---

## 9. Implementation Order

1. **Create DAX HTTP API endpoint** (FastMCP or REST)
2. **Create Picobot DAX tool** (`dax_create_run`, `dax_get_status`, `dax_resolve_approval`)
3. **Add intent classification** (simple keyword matching)
4. **Add approval notification** (polling + format)
5. **Add result relay** (format + send)
6. **Add failure handling** (error mapping)

---

## 10. Non-Goals for Phase 7.2

- No multi-workflow orchestration
- No cron/heartbeat logic
- No channel expansion (WhatsApp only)
- No async approval escalation
- No retry logic beyond DAX's existing handling

---

## 11. Success Criteria

| Criterion             | Definition                                              |
| --------------------- | ------------------------------------------------------- |
| Round-trip time       | User request → result delivered < 30s for simple drafts |
| Error rate            | < 1% of requests fail silently                          |
| Approval clarity      | 100% of approval requests include whatHappensNext       |
| Presentation fidelity | No raw enums visible to end user                        |
