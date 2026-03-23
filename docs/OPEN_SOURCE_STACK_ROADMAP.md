# Open Source Stack Roadmap

## Stack Principle

Build DAX outward in this order:

**capabilities → ingress → CI/substrate → transport → identity/secrets → observability**

DAX's value is **governed execution**, not "look how many infra logos we use."

## Five Planes

### 1. Capability Plane

- **Workspace MCP** - shared policy/capability kernel
- **FastMCP** - clean API boundary for external consumers ✅

### 2. Ingress Plane

- **Picobot** - thin ingress for WhatsApp/Telegram
- Keep ingress thin: detect intent → dispatch → approve → recover → notify

### 3. Transport Plane

- **NATS/JetStream** - event bus, approval fan-out, recovery notifications ✅ (Phase C)

### 4. Identity & Secrets Plane

- **ZITADEL** - identity, auth, org/user/workspace access
- **Infisical** - secrets, env injection, provider credentials
- Priority 3 (after transport)

### 5. Observability Plane

- **OpenTelemetry** - traces/events/metrics
- **Prometheus** - metrics collection
- **Grafana** - dashboards
- **Loki** - log aggregation

## Implementation Phases

### Phase A: Finish Core Loop ✅

- Soothsayer UI completion ✅
- `repo_analyze` through Picobot ✅
- MCP capability cleanup ✅

### Phase B: Externalize as Substrate ✅

- **B1: FastMCP externalization** ✅
  - Token auth boundary (`DAX_SUBSTRATE_TOKEN`)
  - 7 tools: health, run.create, run.get, run.approvals.list/resolve, run.recovery.get/execute
  - Separate port (4730) via `DAX_SUBSTRATE_PORT`
  - Enabled via `DAX_SUBSTRATE_ENABLED`
- **B2: GitHub Actions integration** ✅
  - DAX Repo Analyze Gate action
  - Structured outputs: runId, status, terminalReason, artifacts

### Phase C: Event Transport ✅

- **C1: Run lifecycle event bus** ✅
  - `run.created`, `run.started`, `run.state_changed`, `run.completed`, `run.failed` published to NATS
- **C2: Approval events** ✅
  - `approval.requested`, `approval.resolved` published to NATS
- **C3: Recovery events** ✅
  - Recovery notifications published to NATS
- NATS/JetStream subject structure:
  - `dax.runs.<runId>.events` - per-run events
  - `dax.runs.lifecycle` - lifecycle fan-out for all runs
  - `dax.approvals.<runId>` - approval events
  - `dax.recovery.<runId>` - recovery events
- Graceful degradation when NATS unavailable

### Phase D: Production Posture

- ZITADEL
- Infisical
- OTel + Prometheus + Grafana + Loki

## FastMCP Substrate (Phase B1)

### Environment Variables

| Variable                | Default | Description                                          |
| ----------------------- | ------- | ---------------------------------------------------- |
| `DAX_SUBSTRATE_ENABLED` | `false` | Enable FastMCP substrate                             |
| `DAX_SUBSTRATE_TOKEN`   | none    | Bearer token for auth (optional - disabled if unset) |
| `DAX_SUBSTRATE_PORT`    | `4730`  | Port for FastMCP HTTP transport                      |

### Exposed Tools

| Tool                    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `health`                | Health check with version info                      |
| `run.create`            | Create a governed DAX run                           |
| `run.get`               | Get run snapshot (status, steps, trust, governance) |
| `run.approvals.list`    | List pending approvals for a run                    |
| `run.approvals.resolve` | Approve or deny a pending approval                  |
| `run.recovery.get`      | Get recovery summary for a failed/blocked run       |
| `run.recovery.execute`  | Retry a failed run (stub - not yet implemented)     |

### Auth

- Token-based via `Authorization: Bearer <token>` header
- If `DAX_SUBSTRATE_TOKEN` is unset, auth is disabled (dev mode)

### Usage Example

```bash
# Start DAX with substrate enabled
DAX_SUBSTRATE_ENABLED=true DAX_SUBSTRATE_TOKEN=mysecret bun run packages/dax/src/index.ts

# Create a run via MCP
curl -X POST http://localhost:4730/ \
  -H "Authorization: Bearer mysecret" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run.create","arguments":{"intent":{"input":"analyze this repo for security issues"}}}}'
```

## NATS Event Transport (Phase C)

### Environment Variables

| Variable           | Default                 | Description                   |
| ------------------ | ----------------------- | ----------------------------- |
| `DAX_NATS_ENABLED` | `false`                 | Enable NATS transport         |
| `DAX_NATS_URL`     | `nats://localhost:4222` | NATS server URL               |
| `DAX_NATS_CREDS`   | none                    | Path to NATS credentials file |
| `DAX_NATS_STREAM`  | `DAX_EVENTS`            | JetStream stream name         |

### Subject Structure

| Subject                   | Purpose                                 |
| ------------------------- | --------------------------------------- |
| `dax.runs.<runId>.events` | All events for a specific run           |
| `dax.runs.lifecycle`      | Lifecycle events for all runs (fan-out) |
| `dax.approvals.<runId>`   | Approval events for a run               |
| `dax.recovery.<runId>`    | Recovery events for a run               |

### Event Categories

- **Lifecycle**: `run.created`, `run.started`, `run.state_changed`, `run.completed`, `run.failed`
- **Step**: `step.proposed`, `step.started`, `step.completed`, `step.failed`
- **Approval**: `approval.requested`, `approval.resolved`
- **Trust**: `trust.updated`
- **Artifact**: `artifact.created`

### Usage Example

```bash
# Start DAX with NATS transport enabled
DAX_NATS_ENABLED=true DAX_NATS_URL=nats://localhost:4222 bun run packages/dax/src/index.ts

# Subscribe to lifecycle events
nats sub dax.runs.lifecycle

# Subscribe to specific run events
nats sub dax.runs.<runId>.events

# Subscribe to approval events
nats sub dax.approvals.<runId>
```

## Current State

### Completed

- Determinism, replay/recovery
- Picobot ingress (basic)
- Workspace MCP (core)
- Tool allowlisting
- Soothsayer API
- Governance failure visibility
- FastMCP substrate (Phase B1)
- GitHub Actions integration (Phase B2)
- NATS/JetStream event transport (Phase C)

### Deferred

- ZITADEL/Infisical
- Observability stack

## What NOT to Integrate Yet

- Kubernetes-heavy deployment complexity
- Service mesh
- Multiple message buses
- Large data platform pieces
- Vector DB infrastructure
