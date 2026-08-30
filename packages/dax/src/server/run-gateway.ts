import { Bus } from "@/bus"
import { getProjectedRunState, getRunAuthority, hasRunEvents, readRunEvents } from "@/state/events/run-event-store"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Permission } from "@/governance"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { deriveSessionLifecycleFromMessages } from "@/session/lifecycle"
import { RunFactory } from "@/execution/run-factory"
import { WorkerRunWorkflow } from "@/workflows/worker-run"
import { LifecycleReconciler } from "@/runtime/compat/lifecycle-reconciler"
import { ApprovalStore } from "@/approval/approval-store"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import { ApprovalAlreadyResolvedError } from "@/approval/approval-transitions"
import { Tracer } from "@/runtime/telemetry"
import { RunLifecycle } from "@/state/run-lifecycle"
import { RunStore } from "@/state/run-store"
import { replayRunState } from "@/state/replay"
import { getEventAuthorityState } from "@/state/events/event-transitions"
import {
  reduceRunState,
  type ApprovalRecord as CanonicalApprovalRecord,
  type CanonicalRunState,
} from "@/state/events/run-reducer"
import type { RunEventEnvelope } from "@/state/events/run-event-types"
import { isFixedWorkflow, getStepsForWorkflow } from "@/workflows/types"
import { natsTransport } from "./transport/nats-transport"
import { getSecrets } from "@/secrets/secrets-loader"
import type { CreateRunRequest, ResolveApprovalRequest } from "./run-contract"
import {
  type ApprovalRecord,
  type ArtifactRecord,
  type CreateRunResponse,
  type RunCurrentStep,
  type RunEvent,
  type RunListItem,
  type RunOverviewResponse,
  type RunSnapshot,
  type RunSummary,
  type RunTrustState,
  type WorkflowClass,
  type WorkflowSummary,
  type WorkflowTerminalReason,
  type ProjectedRun,
  type RunIntervention,
} from "./run-contract"
import { buildProjectedRun, buildInterventionProjection, mapEventToNarrativeItem } from "./run-projections"
import {
  authorityUnreadable,
  buildRunInspectorProjectionV1,
  legacyUnsupported,
  type RunInspectorReadResultV1,
} from "./run-inspector-projection"

type RunMeta = {
  sourceSystem?: "soothsayer" | "dax" | "cli" | "api"
  initiatedBy?: string
  workspaceId?: string
  projectId?: string
  chatId?: string
  workflowId?: string
  targeting?: {
    mode: "explicit_repo_path" | "default_cwd"
    repoPath?: string
  }
  contractId?: string
  workflowClass?: string
}

const log = Log.create({ service: "run-gateway" })
const legacyLog = Log.create({ service: "run-gateway", subsystem: "legacy" })
const LEGACY_RUN_FALLBACK_FLAG_WARNING =
  "metadata.allowLegacyFallback is deprecated and will be removed after the execution-contract migration window."
const LEGACY_RUN_FALLBACK_USED_WARNING =
  "Execution contract failed and DAX used the deprecated legacy run fallback because allowLegacyFallback was explicitly enabled."

const authorityCounters = Instance.state(() => ({
  dax_state_machine: 0,
  dax_legacy: 0,
  dax_mixed: 0,
}))

const listeners = new Map<string, Set<(event: RunEvent) => void>>()
const partStatusByRun = new Map<string, Map<string, string>>()
const artifactIdsByRun = new Map<string, Set<string>>()
const trustSignatureByRun = new Map<string, string>()
const appendEventTailByRun = new Map<string, Promise<void>>()
const runGatewayState = Instance.state(() => ({
  initialized: false,
}))

/** Resume workflows whose human gate is owned by DAX's canonical approval store. */
async function resumeCanonicalWorkflowApproval(
  runId: string,
  approvalId: string,
  decision: "approve" | "deny",
): Promise<void> {
  const contract = await RunFactory.getContract(runId)
  if (contract?.workflowClass !== "worker_run") return

  // A repeated CLI request may be the recovery path after the approval store
  // was updated but the prior process exited before it could finalize the run.
  // Never append a second terminal decision to an already finished event log.
  const state = await getEventAuthorityState(runId)
  if (state && ["completed", "failed", "cancelled"].includes(state.status)) return

  const workflow = new WorkerRunWorkflow({ runId, contract })
  await workflow.resumeAfterApproval(approvalId, decision === "approve" ? "approved" : "denied")
}

function buildWorkflowSummary(
  workflowClass: string | undefined,
  runState: { steps: Array<{ stepId: string; status: string }> } | null,
): WorkflowSummary | undefined {
  if (!workflowClass || !isFixedWorkflow(workflowClass as WorkflowClass)) {
    return undefined
  }

  const steps = getStepsForWorkflow(workflowClass as WorkflowClass)
  const stepGraph = steps.map((s) => s.stepId)

  let currentStepIndex: number | undefined

  if (runState) {
    const completedStepsCount = runState.steps.filter((s) => s.status === "completed").length
    currentStepIndex = completedStepsCount
  }

  let trustPosture: WorkflowSummary["trustPosture"] = "medium"
  if (workflowClass === "repo_analyze") {
    trustPosture = "high"
  }

  return {
    workflowClass: workflowClass as WorkflowClass,
    stepGraph,
    currentStepIndex: runState ? currentStepIndex : undefined,
    totalSteps: steps.length,
    trustPosture,
    terminalReason: undefined,
  }
}

function extractTerminalReason(events: RunEvent[]): WorkflowTerminalReason | undefined {
  for (const event of [...events].reverse()) {
    if (event.type === "run.completed") {
      return "workflow_completed"
    }
    if (event.type === "run.failed") {
      const error = event.payload.error as { code?: string; message?: string } | undefined
      if (error?.code === "permission_denied") {
        return "permission_denied"
      }
      if (error?.code === "timeout") {
        return "timeout"
      }
      if (error?.code === "contract_mutation" || error?.message?.includes("immutable")) {
        return "contract_mutation"
      }
      return "execution_error"
    }
  }
  return undefined
}

function terminalReasonFromRunState(
  runState: { status: string; error?: { code?: string } | null } | null | undefined,
): WorkflowTerminalReason | undefined {
  if (!runState) return undefined
  if (runState.status === "completed") return "workflow_completed"
  if (runState.status === "cancelled") return "workflow_cancelled"
  if (runState.status !== "failed") return undefined
  if (runState.error?.code === "approval_rejected") return "workflow_rejected"
  if (runState.error?.code === "permission_denied") return "permission_denied"
  if (runState.error?.code === "timeout") return "timeout"
  return "execution_error"
}

// Bridge between the bus event enum (bus/lifecycle.ts:InterventionRequired)
// and the run-contract enum (run-contract.ts:InterventionKind). These diverged
// historically; producers publish bus values and consumers read contract
// values, so the gateway is the right place to translate.
function mapBusInterventionKind(value: string | undefined): "approval" | "ambiguity" | "recovery" | "policy_violation" | "risk_escalation" {
  switch (value) {
    case "approval":
    case "ambiguity":
    case "recovery":
    case "policy_violation":
    case "risk_escalation":
      return value
    case "hitl_task":
      return "approval"
    case "error_recovery":
      return "recovery"
    default:
      return "ambiguity"
  }
}

function iso(timestamp: number | undefined) {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined
}

function mergeWarnings(...groups: Array<string[] | undefined>) {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))]
}

function artifactType(kind?: string): ArtifactRecord["type"] {
  switch (kind) {
    case "diff":
    case "file":
    case "report":
    case "log":
    case "summary":
    case "patch":
      return kind
    default:
      return "report"
  }
}

type GatewayAuthoritySource =
  | { kind: "event-log"; state: CanonicalRunState; events: RunEventEnvelope[] }
  | { kind: "legacy"; state: Awaited<ReturnType<typeof RunStore.get>> }

/**
 * Selects the Gateway's authority source before reading any fallback state.
 * Compatibility events remain available to SSE and narration, but an explicit
 * event-log marker makes the validated canonical log the only state source.
 */
async function loadGatewayAuthoritySource(runId: string): Promise<GatewayAuthoritySource> {
  const authority = await getRunAuthority(runId)
  if (authority === "event-log") {
    const events = await readRunEvents(runId)
    const state = reduceRunState(events)
    if (!state) {
      throw new Error(`Event-authority run ${runId} has no canonical state`)
    }
    return { kind: "event-log", state, events }
  }

  if (authority === null && (await hasRunEvents(runId))) {
    throw new Error(`Run ${runId} has canonical events without a run authority marker`)
  }

  return { kind: "legacy", state: await RunStore.get(runId) }
}

function canonicalApprovalType(value: string): ApprovalRecord["type"] {
  switch (value) {
    case "file_write":
    case "command_execute":
    case "patch_apply":
    case "tool_use":
    case "workflow_gate":
    case "question":
      return value
    case "tool":
      return "tool_use"
    default:
      return "tool_use"
  }
}

function canonicalApprovalRisk(value: string): ApprovalRecord["risk"] {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return value
    default:
      return "medium"
  }
}

function canonicalApprovalStatus(value: CanonicalApprovalRecord["status"]): ApprovalRecord["status"] {
  return value === "rejected" ? "denied" : value
}

function toCanonicalApprovalRecord(runId: string, approval: CanonicalApprovalRecord): ApprovalRecord {
  const status = canonicalApprovalStatus(approval.status)
  return {
    approvalId: approval.approvalId,
    runId,
    type: canonicalApprovalType(approval.approvalType),
    status,
    risk: canonicalApprovalRisk(approval.risk),
    title: approval.title ?? "Approval required",
    reason: approval.reason ?? approval.expectedConsequence ?? "Canonical approval request",
    context: approval.context ?? undefined,
    createdAt: approval.requestedAt,
    updatedAt: approval.decidedAt ?? approval.requestedAt,
    resolvedAt: approval.decidedAt ?? undefined,
    resolution:
      status === "pending"
        ? undefined
        : {
            decision: status === "approved" ? "approve" : "deny",
            actorId: approval.decidedBy ?? undefined,
            source: "system",
            comment: approval.comment ?? undefined,
          },
  }
}

function canonicalArtifacts(
  runId: string,
  events: RunEventEnvelope[],
  sessionArtifacts: NonNullable<Session.Info["state_v2"]>["artifacts"],
): ArtifactRecord[] {
  const decorationById = new Map(sessionArtifacts.map((artifact) => [artifact.id, artifact]))
  const records = new Map<string, ArtifactRecord>()

  for (const event of events) {
    if (event.type !== "artifact_created") continue
    const payload = event.payload as { artifactId: string; artifactType?: string }
    if (records.has(payload.artifactId)) continue
    const decoration = decorationById.get(payload.artifactId)
    records.set(payload.artifactId, {
      artifactId: payload.artifactId,
      runId,
      type: artifactType(payload.artifactType),
      title: String(decoration?.metadata?.title ?? decoration?.path ?? payload.artifactType ?? payload.artifactId),
      createdAt: event.occurredAt,
      path: decoration?.path,
      metadata: decoration?.metadata,
    })
  }

  return [...records.values()]
}

function sessionPermissionFromPreset(input: CreateRunRequest): Permission.Ruleset | undefined {
  const approvalMode = input.personaPreset?.approvalMode
  const riskLevel = input.personaPreset?.riskLevel

  if (!approvalMode && !riskLevel) {
    return undefined
  }

  const permission: Record<string, "allow" | "deny" | "ask"> = {}

  if (approvalMode === "strict") {
    permission.edit = "ask"
    permission.shell = "ask"
    permission.external_directory = "ask"
  } else if (approvalMode === "balanced") {
    permission.edit = "ask"
    permission.shell = "ask"
  }

  if (riskLevel === "critical") {
    permission.edit = "ask"
    permission.shell = "ask"
    permission.external_directory = "ask"
  } else if (riskLevel === "high") {
    permission.shell = "ask"
  }

  return Object.keys(permission).length > 0 ? Permission.fromConfig(permission as any) : undefined
}

function trustPosture(value: unknown): RunTrustState["posture"] {
  switch (value) {
    case "verified":
      return "strong"
    case "policy_clean":
      return "moderate"
    case "review_needed":
      return "guarded"
    default:
      return undefined
  }
}

function runStatusFromLifecycle(
  state: ReturnType<typeof deriveSessionLifecycleFromMessages>["lifecycle_state"],
): RunSnapshot["status"] {
  switch (state) {
    case "created":
      return "created"
    case "awaiting_approval":
      return "waiting_approval"
    case "completed":
      return "completed"
    case "failed":
    case "blocked":
      return "failed"
    case "archived":
      return "cancelled"
    case "planning":
    case "ready":
    case "executing":
    default:
      return "running"
  }
}

function toApprovalRecord(request: Permission.Request): ApprovalRecord {
  const permission = request.permission.toLowerCase()
  const type: ApprovalRecord["type"] =
    permission === "question"
      ? "question"
      : permission === "shell"
        ? "command_execute"
        : permission.includes("patch")
          ? "patch_apply"
          : permission.includes("write") || permission.includes("edit")
            ? "file_write"
            : "tool_use"

  const risk: ApprovalRecord["risk"] =
    type === "command_execute" ? "high" : type === "file_write" || type === "patch_apply" ? "medium" : "low"

  const command = typeof request.metadata?.command === "string" ? request.metadata.command : undefined
  const filePath =
    typeof request.metadata?.filePath === "string"
      ? request.metadata.filePath
      : typeof request.metadata?.path === "string"
        ? request.metadata.path
        : undefined
  const toolName = request.tool ? request.permission : undefined

  return {
    approvalId: request.id,
    runId: request.sessionID,
    type,
    status: "pending",
    risk,
    title: `${request.permission} requires approval`,
    reason: request.patterns.join(", "),
    context: {
      stepId: request.tool?.callID,
      filePath,
      command,
      toolName,
      notes: request.patterns.length > 0 ? request.patterns : undefined,
    },
    createdAt: new Date(request.createdAt).toISOString(),
    updatedAt: new Date(request.createdAt).toISOString(),
  }
}

function mergePendingApprovals(liveApprovals: ApprovalRecord[], eventApprovals: ApprovalRecord[]): ApprovalRecord[] {
  const merged = new Map<string, ApprovalRecord>()

  // Add event-based approvals first (they are the canonical ones)
  for (const approval of eventApprovals) {
    merged.set(approval.approvalId, approval)
  }

  // Add live permissions, but deduplicate if they were already adapted to a canonical approval
  for (const live of liveApprovals) {
    const alreadyAdapted = eventApprovals.some((ea) => ea.context?.originalPermissionId === live.approvalId)
    if (!alreadyAdapted) {
      merged.set(live.approvalId, live)
    }
  }

  return [...merged.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

function pendingApprovalsFromEvents(events: RunEvent[]): ApprovalRecord[] {
  const pending = new Map<string, ApprovalRecord>()

  for (const event of events) {
    if (event.type === "approval.requested") {
      pending.set(event.payload.approval.approvalId, event.payload.approval)
      continue
    }

    if (event.type === "approval.resolved") {
      pending.delete(event.payload.approvalId)
    }
  }

  return [...pending.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

async function getPendingApprovalsForRun(runId: string, events?: RunEvent[]): Promise<ApprovalRecord[]> {
  const [livePending, runEvents] = await Promise.all([
    Permission.list().then((items) => items.filter((item) => item.sessionID === runId).map(toApprovalRecord)),
    events ? Promise.resolve(events) : readEvents(runId),
  ])

  return mergePendingApprovals(livePending, pendingApprovalsFromEvents(runEvents))
}

function toArtifactRecord(runId: string, artifact: any): ArtifactRecord {
  const createdAt = typeof artifact.created_at === "number" ? artifact.created_at : Date.now()
  return {
    artifactId: String(artifact.id ?? `${runId}:${artifact.kind ?? "artifact"}:${createdAt}`),
    runId,
    type: artifactType(artifact.kind),
    title: String(artifact.metadata?.title ?? artifact.path ?? artifact.kind ?? "artifact"),
    createdAt: new Date(createdAt).toISOString(),
    path: typeof artifact.path === "string" ? artifact.path : undefined,
    metadata: artifact.metadata ?? undefined,
  }
}

function currentStepFromMessages(messages: MessageV2.WithParts[]): RunCurrentStep | undefined {
  const parts = messages.flatMap((message) => message.parts).toReversed()
  for (const part of parts) {
    if (part.type === "tool") {
      const status =
        part.state.status === "completed"
          ? "completed"
          : part.state.status === "error"
            ? "failed"
            : part.state.status === "running"
              ? "running"
              : "proposed"
      const detail =
        "title" in part.state && typeof part.state.title === "string"
          ? part.state.title
          : typeof part.state.input?.command === "string"
            ? part.state.input.command
            : undefined
      return {
        stepId: part.id,
        status,
        title: `${part.tool}`,
        detail,
      }
    }
    if (part.type === "step-start") {
      return {
        stepId: part.id,
        status: "running",
        title: "Execution step",
      }
    }
  }
  return undefined
}

async function readRunMeta(runId: string): Promise<RunMeta | undefined> {
  return Storage.read<RunMeta>(["run_meta", Instance.project.id, runId]).catch(() => undefined)
}

async function writeRunMeta(runId: string, meta: RunMeta) {
  await Storage.write(["run_meta", Instance.project.id, runId], meta)
}

function sourceSurfaceFromMeta(meta: RunMeta | undefined): RunListItem["sourceSurface"] {
  if (meta?.chatId) return "chat"
  if (meta?.workflowId) return "workflow"
  if (meta?.sourceSystem === "soothsayer") return "direct"
  return "unknown"
}

async function toRunListItem(runId: string): Promise<RunListItem | undefined> {
  const [snapshot, meta] = await Promise.all([RunGateway.getSnapshot(runId), readRunMeta(runId)])

  if (!snapshot || !meta?.sourceSystem) {
    return undefined
  }

  return {
    runId: snapshot.runId,
    title: snapshot.title,
    status: snapshot.status,
    sourceSystem: snapshot.sourceSystem,
    sourceSurface: sourceSurfaceFromMeta(meta),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    currentStep: snapshot.currentStep,
    pendingApprovalCount: snapshot.pendingApprovalCount,
    targeting: meta.targeting,
    workspaceId: meta.workspaceId,
    projectId: meta.projectId,
    chatId: meta.chatId,
    workflowId: meta.workflowId,
    terminalReason: snapshot.terminalReason,
  }
}

async function readEvents(runId: string): Promise<RunEvent[]> {
  return Storage.read<RunEvent[]>(["run_events", Instance.project.id, runId]).catch(() => [])
}

async function writeEvents(runId: string, events: RunEvent[]) {
  await Storage.write(["run_events", Instance.project.id, runId], events)
}

function queueRunEventMutation<T>(runId: string, operation: () => Promise<T>): Promise<T> {
  const previous = appendEventTailByRun.get(runId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  const tail = next.then(
    () => undefined,
    () => undefined,
  )
  appendEventTailByRun.set(runId, tail)
  return next.finally(() => {
    if (appendEventTailByRun.get(runId) === tail) {
      appendEventTailByRun.delete(runId)
    }
  })
}

async function appendEvent(runId: string, event: any) {
  return queueRunEventMutation(runId, async () => {
    const events = await readEvents(runId)
    const sequence = (events.at(-1)?.sequence ?? 0) + 1
    const eventId = `evt_${runId}_${sequence}`

    // Compute polished narrative message
    const narrativeItem = mapEventToNarrativeItem({
      schemaVersion: "v1",
      eventId,
      sequence,
      cursor: eventId,
      runId,
      timestamp: new Date().toISOString(),
      ...event,
    } as any)

    const full: RunEvent = {
      schemaVersion: "v1",
      eventId,
      sequence,
      cursor: eventId,
      runId,
      timestamp: new Date().toISOString(),
      message: narrativeItem?.message,
      ...event,
    } as any
    events.push(full)
    await writeEvents(runId, events)
    listeners.get(runId)?.forEach((listener) => listener(full))
    natsTransport.publish(full).catch(() => {})
    return full
  })
}

async function emitRunState(runId: string, nextStatus: RunSnapshot["status"], reason?: string) {
  const snapshot = await RunGateway.getSnapshot(runId)
  const previousStatus = snapshot?.status ?? "created"
  if (previousStatus === nextStatus && !reason) return
  await appendEvent(runId, {
    type: "run.state_changed",
    payload: {
      previousStatus,
      currentStatus: nextStatus,
      reason,
    },
  })
}

function toolStepTitle(part: MessageV2.ToolPart) {
  if ("title" in part.state && typeof part.state.title === "string" && part.state.title) {
    return part.state.title
  }
  return part.tool
}

async function handlePartUpdated(part: MessageV2.Part) {
  if (part.type !== "tool") return
  const runId = part.sessionID
  const perRun = partStatusByRun.get(runId) ?? new Map<string, string>()
  partStatusByRun.set(runId, perRun)
  const previous = perRun.get(part.id)
  const next = part.state.status
  if (previous === next) return
  perRun.set(part.id, next)

  if (next === "pending") {
    await appendEvent(runId, {
      type: "step.proposed",
      payload: {
        stepId: part.id,
        title: toolStepTitle(part),
        detail: part.tool,
      },
    })
    return
  }

  if (next === "running") {
    await appendEvent(runId, {
      type: "step.started",
      payload: {
        stepId: part.id,
        title: toolStepTitle(part),
        detail: part.tool,
      },
    })
    return
  }

  if (next === "completed") {
    const durationMs =
      "time" in part.state && typeof part.state.time?.start === "number" && typeof part.state.time?.end === "number"
        ? part.state.time.end - part.state.time.start
        : undefined
    await appendEvent(runId, {
      type: "step.completed",
      payload: {
        stepId: part.id,
        title: toolStepTitle(part),
        detail: part.tool,
        durationMs,
      },
    })
    return
  }

  if (next === "error") {
    await appendEvent(runId, {
      type: "step.failed",
      payload: {
        stepId: part.id,
        title: toolStepTitle(part),
        error: {
          code: "tool_error",
          message: part.state.error,
        },
      },
    })
  }
}

async function handleSessionUpdated(info: Session.Info) {
  const runId = info.id
  const artifactSet = artifactIdsByRun.get(runId) ?? new Set<string>()
  artifactIdsByRun.set(runId, artifactSet)
  for (const artifact of info.state_v2?.artifacts ?? []) {
    const record = toArtifactRecord(runId, artifact)
    if (artifactSet.has(record.artifactId)) continue
    artifactSet.add(record.artifactId)
    await appendEvent(runId, {
      type: "artifact.created",
      timestamp: record.createdAt,
      payload: {
        artifact: record,
      },
    })
  }

  const trust = buildTrustState(info.state_v2?.trust_posture)
  const signature = JSON.stringify(trust ?? null)
  if (trust && trustSignatureByRun.get(runId) !== signature) {
    trustSignatureByRun.set(runId, signature)
    await appendEvent(runId, {
      type: "audit.posture_updated",
      payload: {
        trust,
      },
    })
  }
}

function buildTrustState(raw: unknown): RunTrustState | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "string") {
    return {
      posture: trustPosture(raw),
      reasons: [raw],
    }
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    return {
      score: typeof obj.score === "number" ? obj.score : undefined,
      posture: trustPosture(obj.trust_posture ?? obj.posture),
      blocked: typeof obj.blocked === "boolean" ? obj.blocked : undefined,
      reasons: Array.isArray(obj.reasons) ? obj.reasons.filter((x): x is string => typeof x === "string") : undefined,
    }
  }
  return undefined
}

async function handleBusEvent(event: any) {
  switch (event.type) {
    case "session.created":
      await appendEvent(event.properties.info.id, {
        type: "run.created",
        timestamp: new Date(event.properties.info.time.created).toISOString(),
        payload: {
          status: "created",
          title: event.properties.info.title,
        },
      })
      break
    case "session.updated":
      await handleSessionUpdated(event.properties.info)
      break
    case "session.status": {
      const runId = event.properties.sessionID
      if (event.properties.status.type === "busy") {
        const events = await readEvents(runId)
        if (!events.some((item) => item.type === "run.started")) {
          await appendEvent(runId, {
            type: "run.started",
            payload: {
              status: "running",
            },
          })
        }
        await emitRunState(runId, "running", "execution_active")
      } else if (event.properties.status.type === "idle") {
        const snapshot = await RunGateway.getSnapshot(runId)
        if (snapshot.status === "completed") {
          await appendEvent(runId, {
            type: "run.completed",
            payload: {
              status: "completed",
              summaryAvailable: true,
            },
          })
        } else if (snapshot.status === "failed" || snapshot.status === "cancelled") {
          const runState = await getProjectedRunState(runId)
          const stepErrors = runState?.steps.filter((s) => s.status === "failed" && s.error).map((s) => s.error) ?? []
          const firstStepError = stepErrors[0]
          const runError = runState?.error

          const errorCode =
            runError?.code ?? firstStepError?.code ?? (snapshot.status === "cancelled" ? "run_cancelled" : "run_failed")
          const errorMessage =
            runError?.message ?? firstStepError?.message ?? `Run ended with status ${snapshot.status}`

          await appendEvent(runId, {
            type: "run.failed",
            payload: {
              status: "failed",
              error: {
                code: errorCode,
                message: errorMessage,
              },
            },
          })
        }
      }
      break
    }
    case "message.part.updated":
      await handlePartUpdated(event.properties.part)
      break
    case "session.error": {
      if (!event.properties.sessionID) break
      const errorMessage = event.properties.error?.data?.message ?? event.properties.error?.message ?? "Session failed"
      const errorCode = event.properties.error?.name ?? "session_error"

      const authority = await getRunAuthority(event.properties.sessionID)
      const runState = authority === "event-log" ? null : await getProjectedRunState(event.properties.sessionID)
      if (runState) {
        try {
          if (runState.status === "waiting_approval") {
            await RunLifecycle.transition(event.properties.sessionID, "failed", "approval_denied")
          } else if (runState.status === "running") {
            await RunLifecycle.transition(event.properties.sessionID, "failed", "run_failed", {
              error: { code: "execution_error", message: "Run failed during execution", retryable: false },
            })
          } else if (runState.status === "compiled" || runState.status === "queued") {
            await RunLifecycle.transition(event.properties.sessionID, "queued", "execution_queued")
            await RunLifecycle.transition(event.properties.sessionID, "running", "execution_started")
            await RunLifecycle.transition(event.properties.sessionID, "failed", "run_failed", {
              error: { code: "execution_error", message: "Run failed during execution", retryable: false },
            })
          }
        } catch (error) {
          log.warn("failed to transition to failed on session error", { error, runId: event.properties.sessionID })
        }
      }

      await appendEvent(event.properties.sessionID, {
        type: "run.failed",
        payload: {
          status: "failed",
          error: {
            code: errorCode,
            message: errorMessage,
          },
        },
      })
      break
    }
    case "intent.created":
      await appendEvent(event.properties.runId, {
        type: "intent.created",
        payload: {
          intentType: event.properties.intentType,
          goal: event.properties.goal,
          riskLevel: event.properties.riskLevel,
          confidence: event.properties.confidence,
        },
      })
      break
    case "plan.compiled":
      await appendEvent(event.properties.runId, {
        type: "plan.compiled",
        payload: {
          planId: event.properties.planId,
          tasks: event.properties.tasks,
        },
      })
      break
    case "plan.step_promoted":
      await appendEvent(event.properties.runId, {
        type: "plan.step_promoted",
        payload: {
          stepId: event.properties.stepId,
          status: event.properties.status,
        },
      })
      break
    case "intervention.required":
      await appendEvent(event.properties.runId, {
        type: "intervention.required",
        payload: {
          interventionId: event.properties.interventionId || `int_${event.properties.runId}_${Date.now()}`,
          reason: event.properties.reason,
          kind: mapBusInterventionKind(event.properties.kind ?? event.properties.type),
          approvalId: event.properties.approvalId,
          metadata: event.properties.metadata,
        },
      })
      break
    case "intervention.resolved":
      await appendEvent(event.properties.runId, {
        type: "intervention.resolved",
        payload: {
          interventionId: event.properties.interventionId,
          status: event.properties.status,
          comment: event.properties.comment,
          resolvedAt: new Date().toISOString(),
        },
      })
      break
    case "approval.requested": {
      const runId = event.properties.runId
      await appendEvent(runId, {
        type: "approval.requested",
        payload: {
          approval: event.properties.approval,
        },
      })

      const authority = await getRunAuthority(runId)
      const runState = authority === "event-log" ? null : await getProjectedRunState(runId)
      if (runState) {
        if (runState.status === "running") {
          try {
            await RunLifecycle.transition(runId, "waiting_approval", "approval_required")
          } catch (error) {
            log.warn("failed to transition to waiting_approval", { error, runId })
          }
        } else if (runState.status === "queued") {
          try {
            await RunLifecycle.transition(runId, "running", "execution_started")
            await RunLifecycle.transition(runId, "waiting_approval", "approval_required")
          } catch (error) {
            log.warn("failed to transition through running to waiting_approval", { error, runId })
          }
        } else if (runState.status === "compiled") {
          try {
            await RunLifecycle.transition(runId, "queued", "execution_queued")
            await RunLifecycle.transition(runId, "running", "execution_started")
            await RunLifecycle.transition(runId, "waiting_approval", "approval_required")
          } catch (error) {
            log.warn("failed to transition through queued/running to waiting_approval", {
              error,
              runId,
            })
          }
        }
      }

      await emitRunState(runId, "waiting_approval", "approval_pending")
      break
    }
    case "approval.resolved":
      await appendEvent(event.properties.runId, {
        type: "approval.resolved",
        payload: {
          approvalId: event.properties.approvalId,
          status: event.properties.decision === "approve" ? "approved" : "denied",
          decision: event.properties.decision,
          source: "system",
          comment: event.properties.comment,
          resolvedAt: new Date().toISOString(),
        },
      })
      break
    case "artifact.created": {
      const runId = event.properties.runId
      const artifact = event.properties.artifact
      const artifactSet = artifactIdsByRun.get(runId) ?? new Set<string>()
      artifactIdsByRun.set(runId, artifactSet)

      if (!artifactSet.has(artifact.artifactId)) {
        artifactSet.add(artifact.artifactId)
        await appendEvent(runId, {
          type: "artifact.created",
          timestamp: artifact.createdAt,
          payload: {
            artifact,
          },
        })
      }
      break
    }
    case "audit.posture_updated":
      await appendEvent(event.properties.runId, {
        type: "audit.posture_updated",
        payload: {
          trust: event.properties.trust,
          finding: event.properties.finding,
        },
      })
      break
    case "run.state_changed":
      if (event.properties.runId) {
        await emitRunState(event.properties.runId, event.properties.currentStatus, event.properties.reason)
      }
      break
  }
}

export namespace RunGateway {
  export async function initialize() {
    const state = runGatewayState()
    if (state.initialized) return
    state.initialized = true
    const secrets = await getSecrets()
    natsTransport.initialize({ credsData: secrets.natsCredsData }).catch(() => {})
    Bus.subscribeAll(async (event) => {
      try {
        await handleBusEvent(event)
      } catch (error) {
        log.error("failed to handle run event", { error, type: event.type })
      }
    })
  }

  export async function createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
    initialize()
    const compatibilityWarnings = input.metadata?.allowLegacyFallback ? [LEGACY_RUN_FALLBACK_FLAG_WARNING] : []

    try {
      const result = await RunFactory.create({ request: input })
      log.info("run created via execution contract", {
        runId: result.runId,
        contractId: result.contract.contractId,
        workflowClass: result.contract.workflowClass,
        executionMode: result.contract.executionMode,
        riskLevel: result.contract.riskLevel,
        warnings: result.warnings,
      })
      return {
        ...result.response,
        warnings: mergeWarnings(result.response.warnings, result.warnings, compatibilityWarnings),
      }
    } catch (error) {
      if (input.metadata?.allowLegacyFallback) {
        log.warn("execution contract failed, falling back to legacy path as explicitly allowed", { error })
      } else {
        log.error("execution contract failed, refusing silent fallback", { error })
        throw new Error(
          `Execution contract failure. Silent downgrade to legacy path is disabled. To run in legacy mode, specify allowLegacyFallback: true in metadata. Error: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const title = input.intent.input.split("\n")[0]?.trim() || "External run"
    const permission = sessionPermissionFromPreset(input)
    const session = await Session.create({
      title,
      permission,
    })
    await writeRunMeta(session.id, {
      sourceSystem: input.metadata?.source ?? "api",
      initiatedBy: input.metadata?.initiatedBy,
      workspaceId: input.metadata?.workspaceId,
      projectId: input.metadata?.projectId,
      chatId: input.metadata?.chatId,
      workflowId: input.metadata?.workflowId,
      targeting: input.metadata?.targeting,
    })

    if (input.intent.input.trim()) {
      const model =
        input.personaPreset?.providerHint && input.personaPreset?.modelHint
          ? {
              providerID: input.personaPreset.providerHint,
              modelID: input.personaPreset.modelHint,
            }
          : undefined
      SessionPrompt.prompt({
        sessionID: session.id,
        model,
        parts: [
          {
            type: "text",
            text: input.intent.input,
          },
        ],
      }).catch((error) => {
        log.error("failed to start run prompt", { error, runId: session.id })
      })
    }

    return {
      runId: session.id,
      status: "created",
      createdAt: new Date(session.time.created).toISOString(),
      warnings: mergeWarnings(compatibilityWarnings, [LEGACY_RUN_FALLBACK_USED_WARNING]),
    }
  }

  export async function getSnapshot(runId: string): Promise<RunSnapshot> {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    const [session, meta] = await Promise.all([Session.get(runId), readRunMeta(runId)])

    if (source.kind === "event-log") {
      const runState = source.state
      const pending = runState.approvals.filter((approval) => approval.status === "pending")
      const artifacts = canonicalArtifacts(runId, source.events, session.state_v2?.artifacts ?? [])
      const byType = artifacts.reduce<Record<string, number>>((acc, artifact) => {
        acc[artifact.type] = (acc[artifact.type] ?? 0) + 1
        return acc
      }, {})
      const currentStep = (() => {
        if (!runState.currentStepId) return undefined
        const step = runState.steps.find((candidate) => candidate.stepId === runState.currentStepId)
        if (!step) return undefined
        return {
          stepId: step.stepId,
          status: step.status,
          title: step.title,
          detail: step.error?.message,
        }
      })()
      const trust = runState.trust
        ? {
            posture: runState.trust.posture,
            score: runState.trust.score ?? undefined,
            blocked: runState.trust.blocked,
            reasons: runState.trust.reasons,
          }
        : undefined
      const lastCanonicalEvent = source.events.at(-1)

      const counters = authorityCounters()
      counters.dax_state_machine++

      return {
        schemaVersion: "v1",
        authority: "dax-state-machine",
        sourceSystem: meta?.sourceSystem,
        runId,
        status: LifecycleReconciler.toExternal(runState.status),
        createdAt: runState.createdAt,
        updatedAt: runState.updatedAt,
        startedAt: runState.startedAt ?? undefined,
        completedAt: runState.completedAt ?? undefined,
        title: session.title,
        currentStep,
        pendingApprovalCount: pending.length,
        trust,
        artifactSummary: {
          total: artifacts.length,
          byType,
          latestArtifactIds: artifacts.slice(-3).map((artifact) => artifact.artifactId),
        },
        workflow: buildWorkflowSummary(meta?.workflowClass, runState),
        terminalReason: terminalReasonFromRunState(runState),
        metadata: meta,
        lastEvent: lastCanonicalEvent
          ? {
              eventId: lastCanonicalEvent.eventId,
              sequence: lastCanonicalEvent.seq,
              cursor: lastCanonicalEvent.eventId,
              timestamp: lastCanonicalEvent.occurredAt,
            }
          : null,
      }
    }

    const [messages, events] = await Promise.all([Session.messages({ sessionID: runId }), readEvents(runId)])
    let runState = source.state
    if (!runState && events.length > 0) {
      try {
        // Legacy replay predates the projection fields; it reconstructs from the
        // older run.* vocabulary and cannot know about them. Filling explicit
        // empties keeps the shape honest rather than asserting a cast.
        const replayed = replayRunState(events).state
        runState = {
          ...replayed,
          approvals: [],
          evidence: { contract: null, sandbox: null, egressDenials: [] },
          completion: null,
        }
      } catch (err) {
        log.warn("failed to replay run state", { runId, error: String(err) })
      }
    }

    const pending = await getPendingApprovalsForRun(runId, events)

    let status: RunSnapshot["status"]
    let currentStep: RunSnapshot["currentStep"]
    let startedAt: string | undefined
    let completedAt: string | undefined
    let trust: RunSnapshot["trust"]

    if (runState) {
      status = LifecycleReconciler.toExternal(runState.status)
      startedAt = runState.startedAt ?? undefined
      completedAt = runState.completedAt ?? undefined
      trust = runState.trust
        ? {
            posture: runState.trust.posture,
            score: runState.trust.score ?? undefined,
            blocked: runState.trust.blocked,
            reasons: runState.trust.reasons,
          }
        : undefined

      if (runState.currentStepId) {
        const step = runState.steps.find((s) => s.stepId === runState.currentStepId)
        if (step) {
          currentStep = {
            stepId: step.stepId,
            status: step.status,
            title: step.title,
            detail: step.error?.message,
          }
        }
      }

      if (runState.pendingApprovalIds.length !== pending.length) {
        log.debug("approval count mismatch between run state and permissions", {
          runId,
          runStateApprovals: runState.pendingApprovalIds.length,
          actualApprovals: pending.length,
        })
      }
    } else {
      const lifecycle = deriveSessionLifecycleFromMessages({
        archivedAt: session.time.archived,
        pendingApprovalCount: pending.length,
        retainedArtifactCount: session.state_v2?.artifacts.length ?? 0,
        diffCount: session.summary?.diffs?.length ?? session.summary?.files ?? 0,
        messages,
        hasPlan: !!session.state_v2?.plan,
        isPlanning: session.state_v2?.plan?.status === "running",
      })
      status = runStatusFromLifecycle(lifecycle.lifecycle_state)
      currentStep = currentStepFromMessages(messages)
      startedAt = messages.length > 0 ? iso(messages[0]?.info.time.created) : undefined
      completedAt = (() => {
        if (!lifecycle.terminal || messages.length === 0) return undefined
        const assistant = [...messages]
          .reverse()
          .find(
            (message): message is MessageV2.WithParts & { info: MessageV2.Assistant } =>
              message.info.role === "assistant",
          )
        return iso(assistant?.info.time.completed)
      })()
      trust = (() => {
        const sessionTrust = buildTrustState(session.state_v2?.trust_posture)
        if (!sessionTrust) return undefined
        return {
          ...sessionTrust,
          blocked: sessionTrust.blocked ?? lifecycle.lifecycle_state === "awaiting_approval",
        }
      })()
    }

    const sessionArtifacts = session.state_v2?.artifacts ?? []
    const stateArtifactIds = runState?.artifactIds ?? []
    const artifacts = sessionArtifacts
    const byType = artifacts.reduce<Record<string, number>>((acc, artifact) => {
      const kind = artifactType(artifact.kind)
      acc[kind] = (acc[kind] ?? 0) + 1
      return acc
    }, {})

    const authority: RunSnapshot["authority"] = runState ? "dax-state-machine" : "dax-legacy"

    if (authority === "dax-legacy") {
      const counters = authorityCounters()
      counters.dax_legacy++
      legacyLog.warn("run using legacy execution path - no persisted run state found", {
        runId,
        sessionCreatedAt: session.time.created,
      })
      Tracer.legacyFallback(runId, "no_persisted_run_state")
    } else {
      const counters = authorityCounters()
      counters.dax_state_machine++
    }

    return {
      schemaVersion: "v1",
      authority,
      sourceSystem: meta?.sourceSystem,
      runId,
      status,
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: runState?.updatedAt ?? new Date(session.time.updated).toISOString(),
      startedAt,
      completedAt,
      title: session.title,
      currentStep,
      pendingApprovalCount: pending.length,
      trust,
      artifactSummary: {
        total: artifacts.length || stateArtifactIds.length,
        byType,
        latestArtifactIds: artifacts.length
          ? artifacts.slice(-3).map((artifact) => String(artifact.id))
          : stateArtifactIds.slice(-3),
      },
      workflow: buildWorkflowSummary(meta?.workflowClass, runState),
      terminalReason: extractTerminalReason(events) ?? terminalReasonFromRunState(runState),
      metadata: meta as Record<string, any>,
      lastEvent:
        events.at(-1) !== undefined
          ? {
              eventId: events.at(-1)!.eventId,
              sequence: events.at(-1)!.sequence,
              cursor: events.at(-1)!.cursor,
              timestamp: events.at(-1)!.timestamp,
            }
          : null,
    }
  }

  /**
   * The canonical-only inspector read boundary. This deliberately does not
   * compose existing Gateway projections: those reads may include session or
   * compatibility state for legacy support. A successful result is fresh only
   * when this invocation validated one canonical event snapshot and returns
   * its sequence/cursor.
   */
  export async function getInspectorProjection(runId: string): Promise<RunInspectorReadResultV1> {
    initialize()

    let authority: Awaited<ReturnType<typeof getRunAuthority>>
    try {
      authority = await getRunAuthority(runId)
    } catch {
      return authorityUnreadable(runId, "authority_marker_unreadable")
    }

    if (authority === "legacy") {
      return legacyUnsupported(runId, "legacy_authority")
    }

    if (authority === null) {
      try {
        // An unmarked log is canonical corruption, never an invitation to use
        // session or compatibility state. An empty unmarked run is genuinely
        // outside this canonical inspector's supported authority model.
        const events = await readRunEvents(runId)
        return events.length > 0
          ? authorityUnreadable(runId, "authority_marker_missing")
          : legacyUnsupported(runId, "no_canonical_authority")
      } catch {
        return authorityUnreadable(runId, "canonical_log_unreadable")
      }
    }

    let events: RunEventEnvelope[]
    try {
      events = await readRunEvents(runId)
    } catch {
      return authorityUnreadable(runId, "canonical_log_unreadable")
    }

    if (events.length === 0) return authorityUnreadable(runId, "canonical_log_empty")

    let contract: Awaited<ReturnType<typeof RunFactory.getContract>>
    try {
      contract = await RunFactory.getContract(runId)
    } catch {
      // A valid event-authority marker makes a contract storage failure an
      // authority failure. Do not downgrade to session, mutable permissions,
      // or compatibility projections.
      return authorityUnreadable(runId, "execution_contract_unreadable")
    }
    if (!contract) return authorityUnreadable(runId, "execution_contract_missing")

    let state: CanonicalRunState | null
    try {
      state = reduceRunState(events)
    } catch {
      return authorityUnreadable(runId, "canonical_state_unreadable")
    }
    if (!state) return authorityUnreadable(runId, "canonical_log_empty")

    if (contract.runId !== runId || contract.contractId !== state.contractId) {
      return authorityUnreadable(runId, "execution_contract_mismatch")
    }

    try {
      return buildRunInspectorProjectionV1({ runId, contract, state, events })
    } catch {
      // Schema/projection failures are evidence that the supposedly canonical
      // snapshot cannot be read truthfully, not a reason to offer a partial
      // or compatibility projection.
      return authorityUnreadable(runId, "canonical_state_unreadable")
    }
  }

  export async function getApprovals(runId: string): Promise<ApprovalRecord[]> {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    if (source.kind === "event-log") {
      return source.state.approvals
        .filter((approval) => approval.status === "pending")
        .map((approval) => toCanonicalApprovalRecord(runId, approval))
    }

    const canonicalApprovals = await ApprovalStore.pending(runId)
    if (canonicalApprovals.length > 0) {
      return canonicalApprovals.map((approval) => ({
        approvalId: approval.approvalId,
        runId: approval.runId,
        type: approval.type,
        status: approval.status,
        risk: approval.risk,
        title: approval.title,
        reason: approval.reason,
        context: approval.context,
        createdAt: approval.requestedAt,
        updatedAt: approval.resolvedAt ?? approval.requestedAt,
        resolvedAt: approval.resolvedAt ?? undefined,
        resolution: approval.resolution
          ? {
              decision: approval.resolution.decision,
              source: "system",
              actorId: approval.resolution.actorId,
              comment: approval.resolution.comment,
            }
          : undefined,
      }))
    }
    const legacyApprovals = await getPendingApprovalsForRun(runId)
    if (legacyApprovals.length > 0) {
      return legacyApprovals
    }
    return []
  }

  export async function getInterventions(runId: string): Promise<RunIntervention[]> {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    if (source.kind === "event-log") {
      // Compatibility interventions remain visible on the raw SSE feed, but
      // there is no canonical intervention record to project as run truth.
      return []
    }
    const events = await readEvents(runId)
    return buildInterventionProjection(events)
  }

  export async function resolveApproval(runId: string, approvalId: string, input: ResolveApprovalRequest) {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    if (source.kind === "event-log") {
      const canonicalApproval = source.state.approvals.find((approval) => approval.approvalId === approvalId)
      if (!canonicalApproval) {
        throw new Storage.NotFoundError({ message: `Approval not found: ${approvalId}` })
      }

      const decision = canonicalApproval.status === "pending"
        ? input.decision
        : canonicalApproval.status === "approved"
          ? "approve"
          : "deny"

      if (canonicalApproval.status === "pending") {
        if (decision === "approve") {
          await ApprovalTransitions.approve(runId, approvalId, input.actorId, input.comment)
        } else {
          await ApprovalTransitions.deny(runId, approvalId, input.actorId, input.comment)
        }
      }

      const originalPermissionId = canonicalApproval.context?.originalPermissionId
      if (originalPermissionId) {
        const livePermission = (await Permission.list()).find((item) => item.id === originalPermissionId)
        if (livePermission) {
          await Permission.reply({
            requestID: originalPermissionId,
            reply: decision === "approve" ? "once" : "reject",
            message: input.comment,
          })
        }
      }

      await resumeCanonicalWorkflowApproval(runId, approvalId, decision)

      const updatedSource = await loadGatewayAuthoritySource(runId)
      if (updatedSource.kind !== "event-log") {
        throw new Error(`Run ${runId} lost canonical authority while resolving approval ${approvalId}`)
      }
      const updated = updatedSource.state.approvals.find((approval) => approval.approvalId === approvalId)
      if (!updated) {
        throw new Error(`Canonical approval ${approvalId} disappeared after resolution`)
      }
      const record = toCanonicalApprovalRecord(runId, updated)
      return {
        approvalId,
        status: record.status,
        resolution: record.resolution ?? {
          decision,
          actorId: input.actorId,
          source: input.source === "api" ? "system" : input.source ?? "system",
          comment: input.comment,
        },
        resolvedAt: record.resolvedAt,
      }
    }

    const canonicalApproval = await ApprovalStore.get(runId, approvalId)

    if (canonicalApproval) {
      const decision = canonicalApproval.status === "pending" ? input.decision : canonicalApproval.resolution?.decision
      if (!decision) {
        throw new ApprovalAlreadyResolvedError(approvalId, canonicalApproval.status)
      }

      if (canonicalApproval.status === "pending") {
        if (decision === "approve") {
          await ApprovalTransitions.approve(runId, approvalId, input.actorId, input.comment)
        } else {
          await ApprovalTransitions.deny(runId, approvalId, input.actorId, input.comment)
        }
      }

      const originalPermissionId = canonicalApproval.context?.originalPermissionId
      if (originalPermissionId) {
        const livePermission = (await Permission.list()).find(
          (item) => item.id === originalPermissionId,
        )
        if (livePermission) {
          await Permission.reply({
            requestID: originalPermissionId,
            reply: decision === "approve" ? "once" : "reject",
            message: input.comment,
          })
        }
      }

      // A CLI or remote operator may resolve this in a later process. Rebuild
      // the workflow from its immutable contract so the state machine owns
      // the terminal transition instead of a transient callback.
      await resumeCanonicalWorkflowApproval(runId, approvalId, decision)

      const updated = await ApprovalStore.get(runId, approvalId)
      return {
        approvalId,
        status: updated?.status ?? (decision === "approve" ? "approved" : "denied"),
        resolution: updated?.resolution ?? {
          decision,
          actorId: input.actorId,
          source: input.source || "system",
          comment: input.comment,
        },
        resolvedAt: updated?.resolvedAt ?? new Date().toISOString(),
      }
    }

    const approvals = await Permission.list()
    const existing = approvals.find((item) => item.id === approvalId && item.sessionID === runId)
    if (!existing) {
      const events = await readEvents(runId)
      const prior = [...events]
        .reverse()
        .find(
          (event): event is RunEvent & { type: "approval.resolved" } =>
            event.type === "approval.resolved" && event.payload.approvalId === approvalId,
        )
      if (prior) {
        return {
          approvalId,
          status: prior.payload.status,
          resolution: {
            decision: prior.payload.decision,
            actorId: prior.payload.actorId,
            source: prior.payload.source,
            comment: prior.payload.comment,
          },
          resolvedAt: prior.payload.resolvedAt,
        }
      }
      throw new Storage.NotFoundError({ message: `Approval not found: ${approvalId}` })
    }
    await Permission.reply({
      requestID: approvalId,
      reply: input.decision === "approve" ? "once" : "reject",
      message: input.comment,
    })
    return {
      approvalId,
      status: input.decision === "approve" ? "approved" : "denied",
      resolution: {
        decision: input.decision,
        actorId: input.actorId,
        source: input.source || "system",
        comment: input.comment,
      },
      resolvedAt: new Date().toISOString(),
    }
  }

  export async function listArtifacts(runId: string) {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    const session = await Session.get(runId)
    if (source.kind === "event-log") {
      return canonicalArtifacts(runId, source.events, session.state_v2?.artifacts ?? [])
    }
    return (session.state_v2?.artifacts ?? []).map((artifact) => toArtifactRecord(runId, artifact))
  }

  export async function getSummary(runId: string): Promise<RunSummary> {
    initialize()
    const source = await loadGatewayAuthoritySource(runId)
    const [snapshot, events, meta] = await Promise.all([
      getSnapshot(runId),
      readEvents(runId),
      readRunMeta(runId),
    ])
    const runState = source.state

    let stepCount = 0
    let approvalCount = 0
    let artifactCount = 0
    let approvedApprovals = 0
    let deniedApprovals = 0

    if (source.kind === "event-log") {
      stepCount = source.state.steps.length
      approvalCount = source.state.approvals.length
      artifactCount = source.state.artifactIds.length
      approvedApprovals = source.state.approvals.filter((approval) => approval.status === "approved").length
      deniedApprovals = source.state.approvals.filter((approval) => approval.status === "rejected").length
    } else if (runState) {
      stepCount = runState.steps.length
      approvalCount = events.filter((event) => event.type === "approval.requested").length
      artifactCount = runState.artifactIds.length
    } else {
      stepCount = events.filter((event) => event.type === "step.completed" || event.type === "step.failed").length
      approvalCount = events.filter((event) => event.type === "approval.requested").length
      artifactCount = events.filter((event) => event.type === "artifact.created").length
    }

    if (source.kind === "legacy") {
      approvedApprovals = events.filter(
        (event) => event.type === "approval.resolved" && event.payload.decision === "approve",
      ).length
      deniedApprovals = events.filter(
        (event) => event.type === "approval.resolved" && event.payload.decision === "deny",
      ).length
    }

    let outcomeResult: "success" | "failure" | "partial" | "pending" | undefined
    let terminalReason: string | undefined

    if (snapshot.status === "completed") {
      outcomeResult = "success"
      terminalReason = "Workflow completed successfully"
    } else if (snapshot.status === "failed") {
      outcomeResult = "failure"
      if (runState?.error) {
        terminalReason = runState.error.message
      } else {
        const failedEvent = events.find((e) => e.type === "run.failed")
        terminalReason = failedEvent?.payload.error?.message ?? "Run failed"
      }
    } else if (snapshot.status === "waiting_approval") {
      outcomeResult = "pending"
      terminalReason = "Awaiting approval"
    } else if (snapshot.status === "running") {
      outcomeResult = "pending"
      terminalReason = "Execution in progress"
    }

    return {
      runId,
      status: snapshot.status,
      authority: snapshot.authority,
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      stepCount,
      completedStepCount: runState ? runState.steps.filter((s) => s.status === "completed").length : undefined,
      failedStepCount: runState ? runState.steps.filter((s) => s.status === "failed").length : undefined,
      approvalCount: approvalCount || approvedApprovals + deniedApprovals,
      approvedCount: approvedApprovals || undefined,
      deniedCount: deniedApprovals || undefined,
      pendingApprovalCount: runState ? runState.pendingApprovalIds.length : snapshot.pendingApprovalCount || undefined,
      artifactCount,
      trust: snapshot.trust,
      workflow: buildWorkflowSummary(meta?.workflowClass, runState),
      terminalReason: source.kind === "event-log" ? snapshot.terminalReason : extractTerminalReason(events),
      outcome: outcomeResult
        ? {
            result: outcomeResult,
            summaryText: terminalReason,
            terminalReason,
          }
        : undefined,
    }
  }

  export async function getProjections(runId: string): Promise<ProjectedRun> {
    initialize()
    const [source, snapshot, events, approvals, artifacts, summary] = await Promise.all([
      loadGatewayAuthoritySource(runId),
      getSnapshot(runId),
      readEvents(runId),
      getApprovals(runId),
      listArtifacts(runId),
      getSummary(runId),
    ])

    return buildProjectedRun(snapshot, events, approvals, artifacts, summary, {
      compatibilityEventsAreNarrativeOnly: source.kind === "event-log",
    })
  }

  export async function replayEvents(runId: string, cursor?: string) {
    initialize()
    const events = await readEvents(runId)
    if (!cursor) return events
    const index = events.findIndex((event) => event.cursor === cursor || event.eventId === cursor)
    return index === -1 ? events : events.slice(index + 1)
  }

  export function subscribe(runId: string, listener: (event: RunEvent) => void) {
    initialize()
    const set = listeners.get(runId) ?? new Set<(event: RunEvent) => void>()
    listeners.set(runId, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(runId)
    }
  }

  export async function getOverview(limit = 25): Promise<RunOverviewResponse> {
    initialize()

    const runIds: string[] = []
    for await (const session of Session.list()) {
      const meta = await readRunMeta(session.id)
      if (!meta?.sourceSystem) continue
      runIds.push(session.id)
    }

    const listItems = (await Promise.all(runIds.map((runId) => toRunListItem(runId)))).filter(
      (item): item is RunListItem => Boolean(item),
    )

    const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000
    const now = Date.now()

    const activeRuns = listItems
      .filter((item) => {
        if (!["created", "queued", "running", "waiting_approval"].includes(item.status)) return false
        const ageMs = now - Date.parse(item.updatedAt)
        if (item.status === "waiting_approval" && ageMs > STALE_THRESHOLD_MS) return false
        return true
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit)

    const recentRuns = listItems
      .filter((item) => ["completed", "failed", "cancelled"].includes(item.status))
      .sort((a, b) => {
        const left = Date.parse(b.completedAt ?? b.updatedAt)
        const right = Date.parse(a.completedAt ?? a.updatedAt)
        return left - right
      })
      .slice(0, limit)

    const pendingApprovalSummaries = (
      await Promise.all(
        activeRuns.map(async (run) => {
          const approvals = await getApprovals(run.runId)
          return approvals.map((approvalRecord) => ({
            approvalId: approvalRecord.approvalId,
            runId: approvalRecord.runId,
            type: approvalRecord.type,
            risk: approvalRecord.risk,
            title: approvalRecord.title,
            reason: approvalRecord.reason,
            createdAt: approvalRecord.createdAt,
            targeting: run.targeting,
            sourceSurface: run.sourceSurface ?? ("unknown" as const),
            workspaceId: run.workspaceId,
            projectId: run.projectId,
          }))
        }),
      )
    )
      .flat()
      .map((approval) => {
        const run = listItems.find((item) => item.runId === approval.runId)
        return {
          ...approval,
          targeting: run?.targeting,
          sourceSurface: run?.sourceSurface ?? ("unknown" as const),
          workspaceId: run?.workspaceId,
          projectId: run?.projectId,
        }
      })
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit)

    return {
      activeRuns,
      recentRuns,
      pendingApprovals: pendingApprovalSummaries,
    }
  }

  export const __testing = {
    appendEvent,
  }

  export function getAuthorityCounters() {
    const counters = authorityCounters()
    return {
      dax_state_machine: counters.dax_state_machine,
      dax_legacy: counters.dax_legacy,
      dax_mixed: counters.dax_mixed,
      total: counters.dax_state_machine + counters.dax_legacy + counters.dax_mixed,
    }
  }

  export function resetAuthorityCounters() {
    const counters = authorityCounters()
    counters.dax_state_machine = 0
    counters.dax_legacy = 0
    counters.dax_mixed = 0
  }
}
