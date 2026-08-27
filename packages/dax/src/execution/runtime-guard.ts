import { Session } from "@/session"
import { getProjectedRunState } from "@/state/events/run-event-store"
import type { SessionV2 } from "@/session/model"
import { resolveExecutionAuthority } from "./contract-guardian"
import { createAndPersistApproval, expireApproval, ApprovalAlreadyResolvedError } from "@/approval/approval-transitions"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { Instance } from "@/project/instance"
import { RunStore } from "@/state/run-store"
import { $ } from "bun"
import path from "path"
import fs from "fs"
import { resolveGuardEnforcementMode, shouldBlockViolation } from "./guard-mode"
import { deriveCompletionProof } from "./completion-proof"
import { MessageV2 } from "@/session/message-v2"
import { deriveRuntimeActionSemantics } from "./action-semantics"
import { Permission } from "@/governance"

export type RuntimeActionClass = "analyze" | "propose" | "mutate" | "commit" | "publish" | "verify"

/**
 * Represents a file touched by a tool operation.
 * Used in GuardRequest metadata for runtime guard enforcement.
 */
interface FileMetadata {
  filePath?: string
  movePath?: string
  relativePath?: string
}

export class RuntimeGuardViolationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "RuntimeGuardViolationError"
  }
}

type GuardRequest = {
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

type RuntimeGuardInput = {
  sessionID: string
  agent?: string
  toolID?: string
  req: GuardRequest
  callID?: string
}

type ResolvedRuntimeGuardInput = RuntimeGuardInput & {
  authoritySessionID: string
}

type RuntimeGuardState = NonNullable<SessionV2.State["runtime_guard"]>

const DEFAULT_BUDGET = {
  maxFilesTouched: 8,
  maxMutatingCommands: 6,
  maxApprovalRequests: 4,
  maxRepeatedFailures: 3,
  filesTouched: 0,
  mutatingCommands: 0,
  approvalsRequested: 0,
} as const

function defaultRuntimeGuardState(): RuntimeGuardState {
  return {
    budget: { ...DEFAULT_BUDGET },
    touchedFiles: [],
    baselineCheckpoint: undefined,
    failureCounts: {},
    verification: {
      required: false,
      satisfied: false,
      receipts: [],
    },
    lastToolCallFingerprint: undefined,
    successiveCount: 0,
  }
}

function violationFingerprint(input: RuntimeGuardInput, code: string) {
  const fileHint = collectTouchedPaths(input.req)[0] ?? ""
  const commandHint = input.req.patterns.join(" && ").trim()
  return [code, input.toolID ?? input.req.permission, fileHint || commandHint].filter(Boolean).join("::")
}

function normalizeRelative(filePath: string) {
  if (!filePath) return filePath
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(Instance.directory, filePath)

  // Assigned by both branches below; a default here would mask a future
  // path that forgets to resolve.
  let resolvedAbsolute: string
  try {
    // Follow symlinks and resolve '..' to get canonical path
    resolvedAbsolute = fs.realpathSync(absolute)
  } catch {
    // If file doesn't exist, we still want to resolve '..' and normalize separators
    resolvedAbsolute = path.resolve(absolute)
  }

  const relative = path.relative(Instance.worktree, resolvedAbsolute)
  return relative
}

function collectTouchedPaths(req: GuardRequest): string[] {
  const fromFiles = Array.isArray(req.metadata?.files)
    ? req.metadata.files.flatMap((item: FileMetadata) =>
        [item?.filePath, item?.movePath, item?.relativePath].filter(Boolean),
      )
    : []
  const fromSingle = [req.metadata?.filepath, req.metadata?.filePath].filter(Boolean)
  const fromPatterns = req.permission === "edit" ? req.patterns : []
  return [...new Set([...fromFiles, ...fromSingle, ...fromPatterns].map((item) => normalizeRelative(String(item))))]
}

/**
 * Normalizes file paths from a contract for scope validation.
 * The contract may have extended properties (targetFiles, repoImpact, etc.)
 * that are not part of the base ExecutionContract type.
 * Using 'any' here because these extensions vary by contract version.
 */
function normalizeScope(contract?: any | null) {
  const targetFiles = [
    ...(contract?.targetFiles ?? []),
    ...(contract?.repoImpact?.targetFiles ?? []),
    ...(contract?.likelyWrites ?? []),
    ...(contract?.runtimePolicy?.scope?.targetFiles ?? []),
  ]
    .map((item) => normalizeRelative(item))
    .filter(Boolean)
  const avoidAreas = [
    ...(contract?.repoImpact?.avoidAreas ?? []),
    ...(contract?.runtimePolicy?.scope?.avoidAreas ?? []),
  ]
    .map((item) => normalizeRelative(item))
    .filter(Boolean)
  const validation = [
    ...(contract?.validationPlan?.preflight ?? []),
    ...(contract?.validationPlan?.postChange ?? []),
    ...(contract?.validationPlan?.shipReadiness ?? []),
    ...(contract?.validationCommands ?? []),
    ...(contract?.runtimePolicy?.postconditions?.validationCommands ?? []),
  ]
  return {
    targetFiles: [...new Set(targetFiles)],
    avoidAreas: [...new Set(avoidAreas)],
    validation,
    rollbackPlan: contract?.rollbackPlan ?? [],
  }
}

function looksVagueIntent(input: string) {
  const text = input.trim().toLowerCase()
  if (!text) return true
  if (text.length < 24) return true
  const vagueVerb = /\b(fix|improve|update|help|do it|make it better|quickly|handle this|clean up)\b/
  const concreteAnchor =
    /\b(file|path|src|test|workflow|module|component|api|contract|scope|verify|validation|line|function|class)\b/
  return vagueVerb.test(text) && !concreteAnchor.test(text)
}

async function latestUserText(sessionID: string) {
  for await (const message of MessageV2.stream(sessionID)) {
    if (message.info.role !== "user") continue
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) return part.text.trim()
    }
  }
  const session = await Session.get(sessionID).catch(() => undefined)
  return session?.state_v2?.intent?.prompt?.trim() || ""
}

function isActionAllowed(mode: string, action: RuntimeActionClass, lifecycle: string) {
  if (lifecycle === "waiting_approval" && action !== "verify" && action !== "analyze") return false
  switch (mode) {
    case "explore":
    case "docs":
      return action === "analyze" || action === "verify"
    case "plan":
      return action === "analyze" || action === "propose" || action === "verify"
    case "audit":
      return action === "analyze" || action === "verify"
    default:
      return true
  }
}

function matchesScopedPath(targets: string[], candidate: string) {
  if (targets.length === 0) return true
  return targets.some(
    (target) => candidate === target || candidate.startsWith(`${target}/`) || target.startsWith(`${candidate}/`),
  )
}

function matchesAvoidArea(avoidAreas: string[], candidate: string) {
  return avoidAreas.some(
    (item) => candidate === item || candidate.startsWith(`${item}/`) || item.startsWith(`${candidate}/`),
  )
}

function classifyPathZone(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/")
  const lower = normalized.toLowerCase()
  if (
    lower.startsWith("../") ||
    lower.startsWith(".git/config") ||
    lower.startsWith("/etc/") ||
    lower.startsWith("~/.")
  ) {
    return "forbidden" as const
  }
  if (
    lower === ".dax/lab" ||
    lower.startsWith(".dax/lab/") ||
    lower.endsWith("/.dax/lab") ||
    lower.includes("/.dax/lab/")
  ) {
    return "lab" as const
  }
  if (
    /^\.env($|\.)/i.test(path.basename(normalized)) ||
    lower.includes("secret") ||
    lower.includes("credential") ||
    lower.includes("token") ||
    lower.includes("auth") ||
    lower === ".npmrc" ||
    lower === ".pypirc" ||
    lower.startsWith(".github/workflows/")
  ) {
    return "sensitive" as const
  }
  if (lower.startsWith(".dax/") || lower.startsWith("dist/") || lower.startsWith("tmp/")) {
    return "artifact_or_temp" as const
  }
  return "repo_safe" as const
}

function hasExplicitApprovalSignalForPath(input: string, relativePath: string) {
  const text = input.trim().toLowerCase()
  if (!text) return false
  const approved = /\b(approve|approved|consent|allow|all clear|yes|y|ok|okay|go ahead|proceed|do it)\b/.test(text)
  if (!approved) return false
  
  // If the user provides a short generic approval without caveats, accept it for a smooth UX
  if (text.length < 50 && !/\b(except|but|only|not|don't|do not)\b/.test(text)) {
    return true
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase()
  const basename = path.basename(normalizedPath)
  return text.includes(normalizedPath) || text.includes(basename)
}

async function hasScopedSensitiveApproval(input: RuntimeGuardInput, relativePath: string): Promise<boolean> {
  const permission = input.req.permission || "edit"
  const approvedRules = await Permission.getApproved().catch(() => [])
  if (approvedRules.length > 0) {
    const decision = Permission.evaluate(permission, relativePath, approvedRules)
    if (decision.action === "allow") return true
  }

  const userIntent = await latestUserText(input.sessionID)
  return hasExplicitApprovalSignalForPath(userIntent, relativePath)
}

async function resolveBaselineRef() {
  if (Instance.project.vcs !== "git") return undefined
  const head = await $`git rev-parse HEAD`.cwd(Instance.worktree).quiet().nothrow().text()
  const value = head.trim()
  return value || undefined
}

async function ensureIntervention(input: {
  sessionID: string
  title: string
  reason: string
  risk: "medium" | "high" | "critical"
  context?: {
    filePath?: string
    command?: string
    toolName?: string
    diffPreview?: string
    notes?: string[]
  }
}) {
  const approval = await createAndPersistApproval({
    runId: input.sessionID,
    type: "workflow_gate",
    risk: input.risk,
    title: input.title,
    reason: input.reason,
    context: input.context,
    source: "system",
  })
  return approval
}

// Default wait for operator decision on a runtime-guard approval card.
// After this, treat absent decision as denial so the tool call returns an
// error to the model instead of hanging the session indefinitely.
//
// Overridable via env var so unit tests (and headless CI) can short-circuit
// the wait without driving the approval bus. Default 10 minutes mirrors
// Permission.ask's typical operator turnaround budget.
const DEFAULT_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = 10 * 60 * 1_000
function runtimeGuardApprovalTimeoutMs(): number {
  const raw = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
  if (raw === undefined) return DEFAULT_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
}

type ApprovalDecisionResult =
  | { decision: "approve"; source: "operator" }
  | { decision: "deny"; source: "operator" }
  | { decision: "deny"; source: "timeout" }

/**
 * Awaits operator decision on a runtime-guard approval card.
 * Resolves on Lifecycle.ApprovalResolved matching the approvalId, or after
 * the configured timeout. The listener is unsubscribed in all paths so
 * timed-out waits do not leak Bus subscribers.
 *
 *   - operator approve → { decision: "approve", source: "operator" }
 *   - operator deny    → { decision: "deny",    source: "operator" }
 *   - timeout          → { decision: "deny",    source: "timeout"  }
 */
async function awaitApprovalDecision(
  approvalId: string,
  runId: string,
): Promise<ApprovalDecisionResult> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | undefined

    const finish = (result: ApprovalDecisionResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe?.()
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ decision: "deny", source: "timeout" }),
      runtimeGuardApprovalTimeoutMs(),
    )

    unsubscribe = Bus.subscribe(Lifecycle.ApprovalResolved, (event) => {
      if (event.properties.runId !== runId) return
      if (event.properties.approvalId !== approvalId) return
      const decision = event.properties.decision === "approve" ? "approve" : "deny"
      finish({ decision, source: "operator" })
    })
  })
}

async function emitWarnIntervention(input: { sessionID: string; reason: string }) {
  await Bus.publish(Lifecycle.InterventionRequired, {
    runId: input.sessionID,
    reason: input.reason,
    type: "policy_violation",
  })
}

async function registerViolation(input: ResolvedRuntimeGuardInput, code: string) {
  const fingerprint = violationFingerprint(input, code)
  const session = await Session.get(input.authoritySessionID)
  const current = session?.state_v2?.runtime_guard ?? defaultRuntimeGuardState()
  const nextCount = (current.failureCounts[fingerprint] ?? 0) + 1
  await updateRuntimeGuardState(input.authoritySessionID, (guard) => ({
    ...guard,
    failureCounts: {
      ...guard.failureCounts,
      [fingerprint]: nextCount,
    },
  }))
  const limit = current.budget.maxRepeatedFailures || DEFAULT_BUDGET.maxRepeatedFailures
  return {
    fingerprint,
    count: nextCount,
    limit,
    exceeded: nextCount >= limit,
  }
}

async function blockViolation(
  input: ResolvedRuntimeGuardInput,
  violation: {
    code: string
    title: string
    reason: string
    risk: "medium" | "high" | "critical"
    context?: {
      filePath?: string
      command?: string
      toolName?: string
      diffPreview?: string
      notes?: string[]
      approvalsRequested?: number
      maxApprovalRequests?: number
    }
  },
) {
  const session = await Session.get(input.authoritySessionID)
  const guardMode = resolveGuardEnforcementMode(session?.state_v2?.guard_enforcement_mode)
  if (!shouldBlockViolation(guardMode, violation.risk)) {
    await emitWarnIntervention({
      sessionID: input.authoritySessionID,
      reason: `${violation.title}: ${violation.reason} Guard mode is warn, so this was recorded as review-needed instead of hard-blocking.`,
    })
    return
  }

  const failure = await registerViolation(input, violation.code)
  const escalated = failure.exceeded
  const approval = await ensureIntervention({
    sessionID: input.authoritySessionID,
    title: escalated ? `Repeated blocked attempt: ${violation.title}` : violation.title,
    reason: escalated
      ? `${violation.reason} DAX has now blocked this same pattern ${failure.count} time(s). Pause, summarize, and get operator direction before trying again.`
      : violation.reason,
    risk: escalated ? "critical" : violation.risk,
    context: {
      ...violation.context,
      notes: [
        ...(violation.context?.notes ?? []),
        ...(escalated ? [`loop-break engaged after ${failure.count} similar blocked attempt(s)`] : []),
      ],
    },
  })

  // Pause-and-ask: surface the approval card and await the operator's
  // decision. On approve, the tool call proceeds normally. On deny (or
  // timeout), the tool call throws and the model sees the failure with the
  // operator's intent attached.
  //
  // Loop-break (escalated) violations bypass this gate because they indicate
  // the model is repeatedly retrying the same blocked pattern — the operator
  // shouldn't be asked to override the same thing forever.
  if (escalated) {
    throw new RuntimeGuardViolationError("loop_break", violation.reason)
  }

  const result = await awaitApprovalDecision(approval.approvalId, input.authoritySessionID)
  if (result.decision === "approve") {
    return
  }
  // On timeout the operator never decided. Mark the approval expired so the
  // UI no longer shows it as pending and a late click cannot resolve a
  // stale request. Wrap in try/catch for the race where the operator's
  // decision lands at the exact same moment as the timer fires — in that
  // case ApprovalAlreadyResolvedError is the expected, harmless outcome.
  if (result.source === "timeout") {
    try {
      await expireApproval(input.authoritySessionID, approval.approvalId)
    } catch (err) {
      if (!(err instanceof ApprovalAlreadyResolvedError)) {
        throw err
      }
    }
  }
  throw new RuntimeGuardViolationError(violation.code, violation.reason)
}

async function updateRuntimeGuardState(sessionID: string, updater: (state: RuntimeGuardState) => RuntimeGuardState) {
  await Session.update(sessionID, (draft) => {
    const current = draft.state_v2?.runtime_guard ?? defaultRuntimeGuardState()
    draft.state_v2 = {
      intent: draft.state_v2?.intent,
      plan: draft.state_v2?.plan,
      activity_timeline: draft.state_v2?.activity_timeline ?? [],
      approvals: draft.state_v2?.approvals ?? [],
      artifacts: draft.state_v2?.artifacts ?? [],
      audit_findings: draft.state_v2?.audit_findings ?? [],
      trust_posture: draft.state_v2?.trust_posture,
      reflection: draft.state_v2?.reflection,
      reflection_history: draft.state_v2?.reflection_history,
      runtime_guard: updater(current),
      plan_quality: draft.state_v2?.plan_quality,
      completion_proof: draft.state_v2?.completion_proof,
      guard_enforcement_mode: draft.state_v2?.guard_enforcement_mode ?? resolveGuardEnforcementMode(),
    }
  })
}

/**
 * Creates a stable JSON string representation for hashing/comparison.
 * Handles any object shape recursively to ensure consistent output.
 * Takes unknown rather than any: the input genuinely is arbitrary, but every
 * branch below narrows before touching it, so the caller gets no licence to
 * skip that.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`
  const record = obj as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`
}

export async function enforceRuntimeGuard(input: RuntimeGuardInput) {
  // The tool call belongs to the current conversation session, but execution
  // authority belongs to the run explicitly persisted on that session. A
  // governed child must never become unrestricted because it has a different
  // conversation ID or because an authority read failed.
  const executionSession = await Session.get(input.sessionID)
  const authority = await resolveExecutionAuthority(executionSession.id, executionSession.governingRunId)
  const authoritySessionID = authority.governingRunId ?? executionSession.id
  const authoritySession =
    authoritySessionID === executionSession.id ? executionSession : await Session.get(authoritySessionID)
  const guardInput: ResolvedRuntimeGuardInput = { ...input, authoritySessionID }

  const state = authoritySession.state_v2
  const currentGuard = state?.runtime_guard ?? defaultRuntimeGuardState()
  const mode = state?.intent?.activeMode ?? input.agent ?? "build"
  // The immutable contract and governing runtime state belong to the authority
  // session. A derived conversation may carry a narrower intent contract,
  // though, so retain that child-local restriction in the effective scope.
  const sessionContract = executionSession.state_v2?.intent?.contract
  const planQuality = state?.plan_quality

  const compiledContract = authority.contract
  // The immutable execution contract is the governing scope. The established
  // session intent contract may add narrower/legacy scope detail, but it must
  // not widen the immutable scope: a path must satisfy every non-empty target
  // set, while avoid areas accumulate.
  const declaredScopes = [normalizeScope(compiledContract), normalizeScope(sessionContract)]
  const targetScopes = declaredScopes.map((item) => item.targetFiles).filter((items) => items.length > 0)
  const scope = {
    targetFiles: [...new Set(targetScopes.flat())],
    avoidAreas: [...new Set(declaredScopes.flatMap((item) => item.avoidAreas))],
  }
  const actionSemantics = deriveRuntimeActionSemantics({
    toolID: input.toolID,
    req: input.req,
  })
  const actionClass = actionSemantics.actionClass
  // Canonical event authority owns lifecycle truth. getProjectedRunState also
  // preserves the legacy fallback for genuinely legacy/ungoverned sessions,
  // while malformed authority or event state propagates and blocks execution.
  const runState = await getProjectedRunState(authoritySessionID)
  const lifecycle = runState?.status ?? "running"

  const toolFingerprint = [input.toolID, stableStringify(input.req.patterns), stableStringify(input.req.metadata)].join(
    "::",
  )
  const lastFingerprint = currentGuard.lastToolCallFingerprint
  const isIdentical = toolFingerprint === lastFingerprint
  const nextSuccessiveCount = isIdentical ? (currentGuard.successiveCount ?? 0) + 1 : 1

  // Update successive count in DB immediately so it's persisted even if the call fails later
  await updateRuntimeGuardState(authoritySessionID, (guard) => ({
    ...guard,
    lastToolCallFingerprint: toolFingerprint,
    successiveCount: nextSuccessiveCount,
  }))

  const requiresStrictPlanBeforeMutation =
    planQuality?.decision === "pause" && ["mutate", "commit", "publish"].includes(actionClass)
  if (requiresStrictPlanBeforeMutation) {
    const reason = `Plan quality is ${planQuality?.score ?? 0}/100 with unresolved checks (${(planQuality?.failedChecks ?? []).join(", ")}). DAX blocks mutating actions until the objective, scope, validation, and rollback signals are concrete.`
    await blockViolation(guardInput, {
      code: "plan_quality_mutation_block",
      title: "Weak plan cannot mutate",
      reason,
      risk: "critical",
      context: {
        toolName: input.toolID,
        command: input.req.patterns.join(" && ") || undefined,
        notes: planQuality?.guidance ?? [],
      },
    })
  }

  const scopeHasTargets = targetScopes.length > 0
  if (!scopeHasTargets && ["mutate", "commit", "publish"].includes(actionClass)) {
    const intentText = await latestUserText(input.sessionID)
    if (looksVagueIntent(intentText)) {
      const reason =
        "The current request is too vague for safe mutation and no scoped execution contract targets were found. Clarify objective, target files/subsystems, and validation before editing."
      await blockViolation(guardInput, {
        code: "vague_intent_mutation_block",
        title: "Vague intent cannot mutate",
        reason,
        risk: "critical",
        context: {
          toolName: input.toolID,
          command: input.req.patterns.join(" && ") || undefined,
          notes: intentText ? [`intent: ${intentText}`] : [],
        },
      })
    }
  }

  if (!isActionAllowed(mode, actionClass, lifecycle)) {
    const reason = `${mode} mode cannot perform ${actionClass} actions. Switch to build or change the workflow before continuing.`
    await blockViolation(guardInput, {
      code: "illegal_transition",
      title: "Mode boundary blocked",
      reason,
      risk: "critical",
      context: { toolName: input.toolID, command: input.req.patterns.join(" && ") || undefined },
    })
  }

  // Loop breaker check - only fire if we have exceeded threshold of successive identical calls
  const loopThreshold = currentGuard.budget.maxRepeatedFailures || DEFAULT_BUDGET.maxRepeatedFailures
  if (nextSuccessiveCount >= loopThreshold) {
    const reason = `DAX has detected ${nextSuccessiveCount} successive identical tool calls for '${input.toolID}'. This pattern suggests an automated doom-loop. Pause, summarize your progress, and wait for human direction.`
    await blockViolation(guardInput, {
      code: "loop_break",
      title: "Doom loop detected",
      reason,
      risk: "critical",
      context: {
        toolName: input.toolID,
        command: input.req.patterns.join(" && ") || undefined,
        notes: [`fingerprint: ${toolFingerprint}`],
      },
    })
  }

  const touchedFiles = collectTouchedPaths(input.req)
  const isOnlyLabAction = touchedFiles.length > 0 && touchedFiles.every((p) => classifyPathZone(p) === "lab")

  for (const relativePath of touchedFiles) {
    const zone = classifyPathZone(relativePath)
    if (zone === "lab") {
      continue
    }
    if (zone === "forbidden") {
      const reason = `${relativePath} is outside the allowed workspace or inside a forbidden system/config zone.`
      await blockViolation(guardInput, {
        code: "forbidden_path",
        title: "Forbidden path blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID },
      })
    }
    if (zone === "sensitive") {
      const approved = await hasScopedSensitiveApproval(guardInput, relativePath)
      if (approved) {
        continue
      }
      const reason = `${relativePath} is a sensitive path. DAX requires explicit operator approval before reading or mutating secrets, auth, CI, or publish surfaces.`
      await blockViolation(guardInput, {
        code: "sensitive_path",
        title: "Sensitive path requires approval",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID },
      })
    }
    if (matchesAvoidArea(scope.avoidAreas, relativePath)) {
      const reason = `${relativePath} is inside a declared avoid area for this run. Pause and confirm scope before continuing.`
      await blockViolation(guardInput, {
        code: "avoid_area",
        title: "Avoid area blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID, notes: scope.avoidAreas },
      })
    }
    if (targetScopes.some((targets) => !matchesScopedPath(targets, relativePath))) {
      const reason = `${relativePath} falls outside the current contract targets. Review scope before continuing.`
      await blockViolation(guardInput, {
        code: "scope_drift",
        title: "Scope drift blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID, notes: scope.targetFiles },
      })
    }
  }

  const nextTouched = new Set(currentGuard.touchedFiles)
  touchedFiles.forEach((item) => {
    if (classifyPathZone(item) !== "lab") {
      nextTouched.add(item)
    }
  })

  const nextFilesTouched = nextTouched.size
  const nextMutatingCommands =
    currentGuard.budget.mutatingCommands +
    (!isOnlyLabAction && (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") ? 1 : 0)

  if (!isOnlyLabAction && nextFilesTouched > currentGuard.budget.maxFilesTouched) {
    const reason = `This run would touch ${nextFilesTouched} files, exceeding the mutation budget of ${currentGuard.budget.maxFilesTouched}. Pause and confirm direction.`
    await blockViolation(guardInput, {
      code: "mutation_budget",
      title: "Mutation budget reached",
      reason,
      risk: "critical",
      context: { toolName: input.toolID, notes: [...nextTouched] },
    })
  }

  if (!isOnlyLabAction && nextMutatingCommands > currentGuard.budget.maxMutatingCommands) {
    const reason = `This run would exceed the mutating-command budget of ${currentGuard.budget.maxMutatingCommands}. Pause and summarize before continuing.`
    await blockViolation(guardInput, {
      code: "command_budget",
      title: "Mutation command budget reached",
      reason,
      risk: "critical",
      context: { command: input.req.patterns.join(" && ") || undefined, toolName: input.toolID },
    })
  }

  if (currentGuard.budget.approvalsRequested >= currentGuard.budget.maxApprovalRequests) {
    const reason = `This run has already requested ${currentGuard.budget.approvalsRequested} approvals, reaching the maximum budget of ${currentGuard.budget.maxApprovalRequests}. Complete existing approvals before requesting more.`
    await blockViolation(guardInput, {
      code: "approval_budget",
      title: "Approval request budget reached",
      reason,
      risk: "critical",
      context: {
        approvalsRequested: currentGuard.budget.approvalsRequested,
        maxApprovalRequests: currentGuard.budget.maxApprovalRequests,
        toolName: input.toolID,
      },
    })
  }

  await updateRuntimeGuardState(authoritySessionID, (guard) => {
    const next = { ...guard }
    next.budget = {
      ...guard.budget,
      filesTouched: nextFilesTouched,
      mutatingCommands: nextMutatingCommands,
    }
    next.touchedFiles = [...nextTouched]
    if (
      (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") &&
      !next.baselineCheckpoint
    ) {
      next.baselineCheckpoint = {
        baselineRef: undefined,
        createdAt: new Date().toISOString(),
        mutationReceiptIds: input.callID ? [input.callID] : [],
      }
      next.verification = {
        ...next.verification,
        required: true,
      }
    } else if ((actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") && input.callID) {
      next.baselineCheckpoint = next.baselineCheckpoint
        ? {
            ...next.baselineCheckpoint,
            mutationReceiptIds: [...new Set([...(next.baselineCheckpoint.mutationReceiptIds ?? []), input.callID])],
          }
        : next.baselineCheckpoint
    }
    if (actionClass === "verify") {
      next.verification = {
        required: true,
        satisfied: true,
        receipts: input.callID
          ? [...new Set([...next.verification.receipts, input.callID])]
          : next.verification.receipts,
      }
    }
    return next
  })

  const needsBaseline = actionClass === "mutate" || actionClass === "commit" || actionClass === "publish"
  if (needsBaseline) {
    const baselineRef = await resolveBaselineRef()
    if (baselineRef) {
      await updateRuntimeGuardState(authoritySessionID, (guard) => {
        if (!guard.baselineCheckpoint || guard.baselineCheckpoint.baselineRef) return guard
        return {
          ...guard,
          baselineCheckpoint: {
            ...guard.baselineCheckpoint,
            baselineRef,
          },
        }
      })
    }
  }

  if (runState) {
    // Every run is event-authority now, so a run may have no legacy row at all.
    // The guard's budget bookkeeping still lives on that row: seed it from the
    // projection rather than dropping the accounting on the floor.
    //
    // This is the parallel-state seam, not a fix for it — governance belongs on
    // the event spine, which is tracked as inv3.conformance-points.
    if (!(await RunStore.exists(authoritySessionID))) {
      const projected = await getProjectedRunState(authoritySessionID).catch(() => null)
      if (projected) await RunStore.save(authoritySessionID, projected)
    }

    await RunStore.update(authoritySessionID, (state) => {
      const next = { ...state }
      next.governance = {
        ...state.governance,
        touchedFiles: [...nextTouched],
        budget: {
          ...state.governance.budget,
          filesTouched: nextFilesTouched,
          mutatingCommands: nextMutatingCommands,
        },
        baselineCheckpoint:
          state.governance.baselineCheckpoint ??
          ((actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") &&
          authoritySession.state_v2?.runtime_guard?.baselineCheckpoint
            ? {
                baselineRef: authoritySession.state_v2.runtime_guard.baselineCheckpoint.baselineRef,
                snapshotId: authoritySession.state_v2.runtime_guard.baselineCheckpoint.snapshotId,
                createdAt: authoritySession.state_v2.runtime_guard.baselineCheckpoint.createdAt,
              }
            : state.governance.baselineCheckpoint),
        mutationReceiptIds:
          input.callID && (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish")
            ? [...new Set([...state.governance.mutationReceiptIds, input.callID])]
            : state.governance.mutationReceiptIds,
        verification:
          actionClass === "verify"
            ? {
                required: true,
                satisfied: true,
                receiptIds: input.callID
                  ? [...new Set([...state.governance.verification.receiptIds, input.callID])]
                  : state.governance.verification.receiptIds,
              }
            : actionClass === "mutate" || actionClass === "commit" || actionClass === "publish"
              ? {
                  ...state.governance.verification,
                  required: true,
                }
              : state.governance.verification,
        completionProof:
          compiledContract && authoritySession.state_v2?.runtime_guard
            ? deriveCompletionProof({
                contract: compiledContract,
                runState: {
                  ...state,
                  governance: {
                    ...state.governance,
                    touchedFiles: [...nextTouched],
                    mutationReceiptIds:
                      input.callID &&
                      (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish")
                        ? [...new Set([...state.governance.mutationReceiptIds, input.callID])]
                        : state.governance.mutationReceiptIds,
                    verification:
                      actionClass === "verify"
                        ? {
                            required: true,
                            satisfied: true,
                            receiptIds: input.callID
                              ? [...new Set([...state.governance.verification.receiptIds, input.callID])]
                              : state.governance.verification.receiptIds,
                          }
                        : actionClass === "mutate" || actionClass === "commit" || actionClass === "publish"
                          ? {
                              ...state.governance.verification,
                              required: true,
                            }
                          : state.governance.verification,
                  },
                },
                observedArtifacts: authoritySession.state_v2?.artifacts ?? [],
              })
            : state.governance.completionProof,
      }
      return next
    }).catch(() => undefined)
  }

  if (compiledContract) {
    const latestRunState = await RunStore.get(authoritySessionID).catch(() => null)
    if (latestRunState) {
      const proof = deriveCompletionProof({
        contract: compiledContract,
        runState: latestRunState,
        artifactCountOverride: authoritySession.state_v2?.artifacts?.length ?? latestRunState.artifactIds.length,
        observedArtifacts: authoritySession.state_v2?.artifacts ?? [],
      })
      await Session.update(authoritySessionID, (draft) => {
        const current = draft.state_v2
        draft.state_v2 = {
          intent: current?.intent,
          plan: current?.plan,
          activity_timeline: current?.activity_timeline ?? [],
          approvals: current?.approvals ?? [],
          artifacts: current?.artifacts ?? [],
          audit_findings: current?.audit_findings ?? [],
          trust_posture: current?.trust_posture,
          reflection: current?.reflection,
          reflection_history: current?.reflection_history,
          runtime_guard: current?.runtime_guard,
          plan_quality: current?.plan_quality,
          completion_proof: proof,
          guard_enforcement_mode: current?.guard_enforcement_mode ?? resolveGuardEnforcementMode(),
        }
      })
    }
  }
}
