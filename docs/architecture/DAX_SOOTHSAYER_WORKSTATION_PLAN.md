---
title: DAX x Soothsayer Workstation Plan
archetype: architecture
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - architecture
  - soothsayer
---

# DAX x Soothsayer Workstation Plan

## Purpose

This document translates the agreed integration contract into the first
implementation slice for Soothsayer.

It is intentionally narrow:

- DAX remains the execution authority.
- Soothsayer becomes the web observer/controller.
- `workspace-mcp` remains the shared capability substrate.

This plan exists to get Milestone 1 shipped without reopening architecture.

## Authority Boundaries

### DAX owns

- run lifecycle truth
- step lifecycle truth
- approval state during execution
- audit/trust state
- artifacts and summaries
- recovery snapshots and event cursors

### Soothsayer owns

- run launch UX
- live run console
- approval modal and later approval inbox
- persona selection and preset mapping
- workflow and chat handoff into DAX
- mirrored projections for UI and analytics

### MCP owns

- governed shared tool contracts
- policy/tool semantics
- transient capability substrate

## Current State

### DAX

The first external run seam now exists in the DAX server:

- `POST /runs`
- `GET /runs/:id`
- `GET /runs/:id/events`
- `GET /runs/:id/approvals`
- `POST /runs/:id/approvals/:approvalId`
- `GET /runs/:id/artifacts`
- `GET /runs/:id/summary`

These routes are a translation layer over canonical DAX session state. They do
not redefine execution truth.

### Soothsayer

Soothsayer already has strong module boundaries:

- chat
- commands
- workflows
- personas
- mcp
- analytics

What is missing is a dedicated DAX integration module. DAX should not be owned
by chat, workflows, or MCP.

## Milestone 1 Goal

Make Soothsayer able to:

1. start a DAX run
2. observe it live
3. resolve approvals
4. render the completion summary

Do not add replay, cross-run approval inboxes, or workflow-native DAX steps in
this first slice.

## Soothsayer Backend Plan

> **Note**: the `apps/api/src/modules/dax/` tree below is the Soothsayer-side
> NestJS module and lives in the Soothsayer repo, not in this repository. The
> DAX-side seams it calls are real: `packages/dax/src/server/routes/run.ts:47-249`
> (HTTP) and `packages/dax/src/soothsayer/soothsayer-api.ts` (client adapter).

Create a new Nest module:

```text
apps/api/src/modules/dax/
  dax.module.ts
  dax.controller.ts
  dax.service.ts
  dax.types.ts
  dax.mapper.ts
```

### `dax.module.ts`

Responsibilities:

- register controller and service
- keep the module isolated from chat/workflow ownership

Suggested wiring:

```ts
@Module({
  controllers: [DaxController],
  providers: [DaxService, DaxMapper],
  exports: [DaxService],
})
export class DaxModule {}
```

### `dax.service.ts`

This service is the thin integration adapter to the DAX gateway.

It should:

- call DAX HTTP endpoints
- pass through typed DTOs
- avoid business logic

It should not:

- reinterpret execution state
- derive trust posture
- own approval decisions
- orchestrate workflow semantics

Suggested methods:

```ts
async createRun(input: CreateDaxRunInput): Promise<CreateRunResponse>
async getRun(runId: string): Promise<RunSnapshot>
streamRunEvents(runId: string, cursor?: string): AsyncIterable<RunEvent>
async getApprovals(runId: string): Promise<GetApprovalsResponse>
async resolveApproval(
  runId: string,
  approvalId: string,
  input: ResolveApprovalRequest,
): Promise<ResolveApprovalResponse>
async getArtifacts(runId: string): Promise<{ runId: string; artifacts: ArtifactRecord[] }>
async getSummary(runId: string): Promise<RunSummary>
```

### `dax.controller.ts`

Expose a Soothsayer-facing surface for the frontend:

```text
POST /dax/runs
GET  /dax/runs/:id
GET  /dax/runs/:id/events
GET  /dax/runs/:id/approvals
POST /dax/runs/:id/approvals/:approvalId
GET  /dax/runs/:id/summary
```

Notes:

- proxy SSE directly if possible
- do not down-convert live truth into polling unless blocked
- keep the controller boring

### `dax.types.ts`

Use temporary mirrored DTOs for the first spike:

- `RunSnapshot`
- `RunEvent`
- `ApprovalRecord`
- `ResolveApprovalRequest`
- `ResolveApprovalResponse`
- `ArtifactRecord`
- `RunSummary`
- `PersonaPreset`
- `CreateRunRequest`
- `CreateRunResponse`

Warning:

These mirrored types are a spike-only compromise. After the first end-to-end
demo, move them to a shared/generated contract so DAX and Soothsayer do not
drift.

### `dax.mapper.ts`

Keep Soothsayer-specific translation out of the controller/service:

- map persona recommendation -> `PersonaPreset`
- map chat/workflow metadata -> create-run payload
- normalize any Soothsayer-facing DTO differences without mutating DAX truth

Suggested methods:

```ts
toCreateRunInput(input: {
  userId?: string
  workspaceId?: string
  projectId?: string
  chatId?: string
  workflowId?: string
  prompt: string
  repoPath?: string
  branch?: string
  personaPreset?: PersonaPreset
}): CreateRunRequest
```

## Soothsayer Frontend Plan

Create the first browser workstation route:

```text
/runs/:id
```

Recommended component tree:

```text
RunPage
  ├── RunHeader
  ├── RunEventStream
  ├── ApprovalModal
  └── RunSummaryCard
```

Do not start with sidebars, dashboards, replay panels, or a full artifact
inspector.

### `RunPage`

Owns page state:

- fetch snapshot
- open SSE connection
- append live events
- manage pending approvals
- fetch summary on completion/failure

Recommended state shape:

```ts
interface RunConsoleState {
  snapshot: RunSnapshot | null
  events: RunEvent[]
  pendingApprovals: ApprovalRecord[]
  summary: RunSummary | null
  connectionState: "idle" | "connecting" | "live" | "reconnecting" | "closed" | "error"
  loadState: "loading" | "ready" | "failed"
}
```

### `RunHeader`

Show only the essentials:

- run id
- current status
- current step
- pending approval count
- trust posture if available

Keep it glanceable. It should read like an operational status line, not a
dashboard.

### `RunEventStream`

This is the main surface.

Render a live execution timeline using human-readable DAX events:

- Run started
- Step proposed
- Step completed
- Approval requested
- Approval resolved
- Run completed
- Run failed

Avoid raw runtime internals in the first version. DAX already emits UI-safe
event text; render that directly.

### `ApprovalModal`

Trigger on `approval.requested`.

Show:

- approval title
- reason
- risk
- minimal context preview

Actions:

- Approve
- Deny
- Optional comment

Important:

The modal should not settle state purely from the POST response. It should wait
for DAX truth via `approval.resolved` or a refreshed approvals list.

### `RunSummaryCard`

Show only after:

- `run.completed`
- `run.failed`

Display:

- final status
- step count
- approval count
- artifact count
- trust posture
- concise outcome summary if available

## Browser SSE Flow

### On page load

1. `GET /dax/runs/:id`
2. Render `RunSnapshot`
3. Open `GET /dax/runs/:id/events`

### On each event

- append to `events`
- lightly project snapshot state in-memory if useful
- fetch approvals when `approval.requested` arrives
- fetch summary when `run.completed` or `run.failed` arrives

### On reconnect

Reconnect using the last cursor:

```text
GET /dax/runs/:id/events?cursor=...
```

Fallback:

- refetch snapshot
- reopen stream

## Approval Flow

1. DAX emits `approval.requested`
2. Soothsayer calls `GET /dax/runs/:id/approvals`
3. UI shows the first pending approval
4. User submits:

```json
{
  "decision": "approve",
  "actorId": "current-user-id",
  "source": "soothsayer",
  "comment": "optional"
}
```

5. Soothsayer waits for DAX-confirmed state via:

- `approval.resolved`, or
- refreshed approvals list

That keeps Soothsayer in the observer/controller role.

## Where Existing Soothsayer Surfaces Fit

### Chat

Do not turn chat into a run console.

Chat should:

1. detect execution intent
2. pick or recommend a persona
3. map persona -> `PersonaPreset`
4. call `daxService.createRun(...)`
5. link the user to `/runs/:id`

### Workflows

Do not integrate workflows yet.

Once the run console is stable, add a `dax_run` step type that:

- creates a DAX run
- stores `runId`
- tracks completion from DAX summary

### Terminal

Keep Terminal as a quick bounded command runner.

Do not blur it with the DAX run console. The new run console owns long-lived
governed execution.

## Soothsayer UX Polish Recommendations

These are polish changes, not product restructuring.

### Terminal

- explicitly frame it as quick command execution
- avoid language that implies long-lived governed AI execution
- keep the terminal status UI concise and utility-focused

### Workflows

- reduce any wording that implies the current workflow engine is already a full
  external execution orchestrator
- make simulated or inline step behavior more honest until `dax_run` exists

### Chat

- keep run handoff explicit
- add language like "Open live run" rather than embedding execution deeply in
  chat bubbles

### Personas

- frame personas as execution presets
- emphasize risk posture, approval mode, verbosity, and capability class
- avoid presenting personas as just long prompt personalities

### Analytics and Dashboard

- remove placeholder-feeling metrics once DAX-backed run data is available
- prefer real run counts, completion state, pending approvals, and trust posture
  over synthetic charts

## Recommended Build Order

### Step 1

Backend adapter:

- `dax.module.ts`
- `dax.service.ts`
- `dax.controller.ts`
- `dax.types.ts`
- `dax.mapper.ts`

### Step 2

Minimal run page:

- snapshot load
- SSE event stream
- event list rendering

### Step 3

Approval modal flow:

- fetch approvals
- approve/deny submit
- wait for DAX-confirmed resolution

### Step 4

Summary rendering:

- completed/failure card

### Step 5

Chat handoff:

- detect execution intent
- create run
- link to run page

## Explicit Deferrals

Do not build these in the first slice:

- cross-run approval inbox
- replay viewer
- multi-run dashboards
- workflow-native `dax_run`
- rich artifact inspector
- MCP expansion for this integration

Those can follow once the first run console proves the workstation model.

## Success Criteria

The first end-to-end slice is successful when a user can:

1. start a DAX run from Soothsayer
2. watch DAX events live in the browser
3. approve a pending action
4. see DAX resume and finish
5. read the final summary

If that flow works, the architecture is proven and the next layers can grow
without guesswork.
