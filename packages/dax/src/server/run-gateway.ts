import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Permission } from "@/governance"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { deriveSessionLifecycleFromMessages } from "@/session/lifecycle"
import type { CreateRunRequest, ResolveApprovalRequest } from "./run-contract"
import {
  type ApprovalRecord,
  type ArtifactRecord,
  type CreateRunResponse,
  type PendingApprovalSummary,
  type RunCurrentStep,
  type RunEvent,
  type RunListItem,
  type RunOverviewResponse,
  type RunSnapshot,
  type RunSummary,
  type RunTrustState,
} from "./run-contract"

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
}

const log = Log.create({ service: "run-gateway" })

const listeners = new Map<string, Set<(event: RunEvent) => void>>()
const partStatusByRun = new Map<string, Map<string, string>>()
const artifactIdsByRun = new Map<string, Set<string>>()
const trustSignatureByRun = new Map<string, string>()
let initialized = false

function iso(timestamp: number | undefined) {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : undefined
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

function runStatusFromLifecycle(state: ReturnType<typeof deriveSessionLifecycleFromMessages>["lifecycle_state"]): RunSnapshot["status"] {
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
    permission === "shell"
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

function mergePendingApprovals(
  liveApprovals: ApprovalRecord[],
  eventApprovals: ApprovalRecord[],
): ApprovalRecord[] {
  const merged = new Map<string, ApprovalRecord>()

  for (const approval of eventApprovals) {
    merged.set(approval.approvalId, approval)
  }

  for (const approval of liveApprovals) {
    merged.set(approval.approvalId, approval)
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
  const [snapshot, meta] = await Promise.all([
    RunGateway.getSnapshot(runId).catch(() => undefined),
    readRunMeta(runId),
  ])

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
  }
}

async function readEvents(runId: string): Promise<RunEvent[]> {
  return Storage.read<RunEvent[]>(["run_events", Instance.project.id, runId]).catch(() => [])
}

async function writeEvents(runId: string, events: RunEvent[]) {
  await Storage.write(["run_events", Instance.project.id, runId], events)
}

async function appendEvent(runId: string, event: Omit<RunEvent, "schemaVersion" | "eventId" | "sequence" | "cursor">) {
  const events = await readEvents(runId)
  const sequence = (events.at(-1)?.sequence ?? 0) + 1
  const eventId = `evt_${runId}_${sequence}`
  const full: RunEvent = {
    schemaVersion: "v1",
    eventId,
    sequence,
    cursor: eventId,
    ...event,
  }
  events.push(full)
  await writeEvents(runId, events)
  listeners.get(runId)?.forEach((listener) => listener(full))
  return full
}

async function emitRunState(runId: string, nextStatus: RunSnapshot["status"], reason?: string) {
  const snapshot = await RunGateway.getSnapshot(runId).catch(() => undefined)
  const previousStatus = snapshot?.status ?? "created"
  if (previousStatus === nextStatus && !reason) return
  await appendEvent(runId, {
    runId,
    type: "run.state_changed",
    timestamp: new Date().toISOString(),
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
      runId,
      type: "step.proposed",
      timestamp: new Date().toISOString(),
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
      runId,
      type: "step.started",
      timestamp: new Date().toISOString(),
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
      runId,
      type: "step.completed",
      timestamp: new Date().toISOString(),
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
      runId,
      type: "step.failed",
      timestamp: new Date().toISOString(),
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
      runId,
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
      runId,
      type: "trust.updated",
      timestamp: new Date().toISOString(),
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
        runId: event.properties.info.id,
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
            runId,
            type: "run.started",
            timestamp: new Date().toISOString(),
            payload: {
              status: "running",
            },
          })
        }
        await emitRunState(runId, "running", "execution_active")
        break
      }
      if (event.properties.status.type === "idle") {
        const snapshot = await RunGateway.getSnapshot(runId).catch(() => undefined)
        if (!snapshot) break
        if (snapshot.status === "completed") {
          await appendEvent(runId, {
            runId,
            type: "run.completed",
            timestamp: new Date().toISOString(),
            payload: {
              status: "completed",
              summaryAvailable: true,
            },
          })
          break
        }
        if (snapshot.status === "failed" || snapshot.status === "cancelled") {
          await appendEvent(runId, {
            runId,
            type: "run.failed",
            timestamp: new Date().toISOString(),
            payload: {
              status: "failed",
              error: {
                code: snapshot.status === "cancelled" ? "run_cancelled" : "run_failed",
                message: `Run ended with status ${snapshot.status}`,
              },
            },
          })
          break
        }
      }
      break
    }
    case "message.part.updated":
      await handlePartUpdated(event.properties.part)
      break
    case "permission.asked": {
      const approval = toApprovalRecord(event.properties)
      await appendEvent(approval.runId, {
        runId: approval.runId,
        type: "approval.requested",
        timestamp: approval.createdAt,
        payload: {
          approval,
        },
      })
      await emitRunState(approval.runId, "waiting_approval", "approval_pending")
      break
    }
    case "permission.replied": {
      await appendEvent(event.properties.sessionID, {
        runId: event.properties.sessionID,
        type: "approval.resolved",
        timestamp: new Date().toISOString(),
        payload: {
          approvalId: event.properties.requestID,
          status: event.properties.reply === "reject" ? "denied" : "approved",
          decision: event.properties.reply === "reject" ? "deny" : "approve",
          source: "system",
          resolvedAt: new Date().toISOString(),
        },
      })
      break
    }
    case "session.error":
      if (!event.properties.sessionID) break
      await appendEvent(event.properties.sessionID, {
        runId: event.properties.sessionID,
        type: "run.failed",
        timestamp: new Date().toISOString(),
        payload: {
          status: "failed",
          error: {
            code: event.properties.error?.name ?? "session_error",
            message: event.properties.error?.data?.message ?? event.properties.error?.message ?? "Session failed",
          },
        },
      })
      break
  }
}

export namespace RunGateway {
  export function initialize() {
    if (initialized) return
    initialized = true
    Bus.subscribeAll((event) => {
      handleBusEvent(event).catch((error) => {
        log.error("failed to handle run event", { error, type: event.type })
      })
    })
  }

  export async function createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
    initialize()
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
    }
  }

  export async function getSnapshot(runId: string): Promise<RunSnapshot> {
    initialize()
    const [session, messages, meta, events] = await Promise.all([
      Session.get(runId),
      Session.messages({ sessionID: runId }),
      readRunMeta(runId),
      readEvents(runId),
    ])
    const pending = await getPendingApprovalsForRun(runId, events)
    const lifecycle = deriveSessionLifecycleFromMessages({
      archivedAt: session.time.archived,
      pendingApprovalCount: pending.length,
      retainedArtifactCount: session.state_v2?.artifacts.length ?? 0,
      diffCount: session.summary?.diffs?.length ?? session.summary?.files ?? 0,
      messages,
      hasPlan: !!session.state_v2?.plan,
      isPlanning: session.state_v2?.plan?.status === "running",
    })
    const artifacts = session.state_v2?.artifacts ?? []
    const byType = artifacts.reduce<Record<string, number>>((acc, artifact) => {
      const kind = artifactType(artifact.kind)
      acc[kind] = (acc[kind] ?? 0) + 1
      return acc
    }, {})
    return {
      schemaVersion: "v1",
      authority: "dax",
      sourceSystem: meta?.sourceSystem,
      runId,
      status: runStatusFromLifecycle(lifecycle.lifecycle_state),
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
      startedAt: messages.length > 0 ? iso(messages[0]?.info.time.created) : undefined,
      completedAt: (() => {
        if (!lifecycle.terminal || messages.length === 0) return undefined
        const assistant = [...messages]
          .reverse()
          .find((message): message is MessageV2.WithParts & { info: MessageV2.Assistant } => message.info.role === "assistant")
        return iso(assistant?.info.time.completed)
      })(),
      title: session.title,
      currentStep: currentStepFromMessages(messages),
      pendingApprovalCount: pending.length,
      trust: (() => {
        const trust = buildTrustState(session.state_v2?.trust_posture)
        if (!trust) return undefined
        return {
          ...trust,
          blocked: trust.blocked ?? lifecycle.lifecycle_state === "awaiting_approval",
        }
      })(),
      artifactSummary: {
        total: artifacts.length,
        byType,
        latestArtifactIds: artifacts.slice(-3).map((artifact) => String(artifact.id)),
      },
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

  export async function getApprovals(runId: string) {
    initialize()
    return getPendingApprovalsForRun(runId)
  }

  export async function resolveApproval(runId: string, approvalId: string, input: ResolveApprovalRequest) {
    initialize()
    const approvals = await Permission.list()
    const existing = approvals.find((item) => item.id === approvalId && item.sessionID === runId)
    if (!existing) {
      const events = await readEvents(runId)
      const prior = [...events].reverse().find((event) => event.type === "approval.resolved" && event.payload.approvalId === approvalId)
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
        source: input.source,
        comment: input.comment,
      },
      resolvedAt: new Date().toISOString(),
    }
  }

  export async function listArtifacts(runId: string) {
    initialize()
    const session = await Session.get(runId)
    return (session.state_v2?.artifacts ?? []).map((artifact) => toArtifactRecord(runId, artifact))
  }

  export async function getSummary(runId: string): Promise<RunSummary> {
    initialize()
    const [snapshot, events] = await Promise.all([getSnapshot(runId), readEvents(runId)])
    const stepCount = events.filter((event) => event.type === "step.completed" || event.type === "step.failed").length
    const approvalCount = events.filter((event) => event.type === "approval.requested").length
    const artifactCount = events.filter((event) => event.type === "artifact.created").length
    return {
      runId,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      stepCount,
      approvalCount,
      artifactCount,
      trust: snapshot.trust,
      outcome:
        snapshot.status === "completed"
          ? {
              result: "success",
            }
          : snapshot.status === "failed"
            ? {
                result: "failure",
              }
            : undefined,
    }
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

    const activeRuns = listItems
      .filter((item) => ["created", "queued", "running", "waiting_approval"].includes(item.status))
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
          const approvals = await getPendingApprovalsForRun(run.runId)
          return approvals.map((approvalRecord) => ({
            approvalId: approvalRecord.approvalId,
            runId: approvalRecord.runId,
            type: approvalRecord.type,
            risk: approvalRecord.risk,
            title: approvalRecord.title,
            reason: approvalRecord.reason,
            createdAt: approvalRecord.createdAt,
            targeting: run.targeting,
            sourceSurface: run.sourceSurface ?? "unknown",
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
          sourceSurface: run?.sourceSurface ?? "unknown",
          workspaceId: run?.workspaceId,
          projectId: run?.projectId,
        }
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)

    return {
      activeRuns,
      recentRuns,
      pendingApprovals: pendingApprovalSummaries,
    }
  }
}
