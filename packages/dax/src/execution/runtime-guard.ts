import { Session } from "@/session"
import type { SessionV2 } from "@/session/model"
import { ContractGuardian } from "./contract-guardian"
import { createAndPersistApproval } from "@/approval/approval-transitions"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { Instance } from "@/project/instance"
import { RunStore } from "@/state/run-store"
import { $ } from "bun"
import path from "path"
import { resolveGuardEnforcementMode, shouldBlockViolation } from "./guard-mode"
import { deriveCompletionProof } from "./completion-proof"
import { MessageV2 } from "@/session/message-v2"

export type RuntimeActionClass = "analyze" | "propose" | "mutate" | "commit" | "publish" | "verify"

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
  metadata: Record<string, any>
  always: string[]
}

type RuntimeGuardInput = {
  sessionID: string
  agent?: string
  toolID?: string
  req: GuardRequest
  callID?: string
}

type RuntimeContract = NonNullable<SessionV2.Intent["contract"]>

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

const VERIFY_COMMAND = /\b(pytest|vitest|jest|cargo test|go test|bun test|npm test|pnpm test|tsc --noEmit|typecheck|ruff check|eslint)\b/i
const COMMIT_COMMAND = /\bgit\s+(commit|merge|rebase|cherry-pick)\b/i
const PUBLISH_COMMAND = /\b(git\s+push|gh\s+pr\s+create|gh\s+release\s+create|npm\s+publish|pnpm\s+publish|cargo\s+publish)\b/i
const MUTATING_COMMAND =
  /\b(rm|mv|cp|mkdir|touch|git\s+add|git\s+restore|git\s+reset|sed\s+-i|perl\s+-pi|tee)\b|[>]{1,2}|\bapply_patch\b/i

function defaultRuntimeGuardState(): RuntimeGuardState {
  return {
    budget: { ...DEFAULT_BUDGET },
    touchedFiles: [],
    rollbackAnchor: undefined,
    failureCounts: {},
    verification: {
      required: false,
      satisfied: false,
      receipts: [],
    },
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
  return path.relative(Instance.worktree, absolute)
}

function collectTouchedPaths(req: GuardRequest): string[] {
  const fromFiles = Array.isArray(req.metadata?.files)
    ? req.metadata.files.flatMap((item: any) => [item?.filePath, item?.movePath, item?.relativePath].filter(Boolean))
    : []
  const fromSingle = [req.metadata?.filepath, req.metadata?.filePath].filter(Boolean)
  const fromPatterns = req.permission === "edit" ? req.patterns : []
  return [...new Set([...fromFiles, ...fromSingle, ...fromPatterns].map((item) => normalizeRelative(String(item))))]
}

function normalizeScope(contract?: RuntimeContract | null) {
  const targetFiles = [
    ...(contract?.targetFiles ?? []),
    ...(contract?.repoImpact?.targetFiles ?? []),
    ...(contract?.likelyWrites ?? []),
  ]
    .map((item) => normalizeRelative(item))
    .filter(Boolean)
  const avoidAreas = (contract?.repoImpact?.avoidAreas ?? []).map((item) => normalizeRelative(item)).filter(Boolean)
  const validation = [
    ...(contract?.validationPlan?.preflight ?? []),
    ...(contract?.validationPlan?.postChange ?? []),
    ...(contract?.validationPlan?.shipReadiness ?? []),
    ...(contract?.validationCommands ?? []),
  ]
  return {
    targetFiles: [...new Set(targetFiles)],
    avoidAreas: [...new Set(avoidAreas)],
    validation,
    rollbackPlan: contract?.rollbackPlan ?? [],
  }
}

function classifyActionClass(req: GuardRequest): RuntimeActionClass {
  if (req.permission === "edit") return "mutate"
  if (req.permission === "external_directory") return "analyze"
  if (req.permission !== "shell") return "analyze"
  const command = req.patterns.join(" && ")
  if (VERIFY_COMMAND.test(command)) return "verify"
  if (PUBLISH_COMMAND.test(command)) return "publish"
  if (COMMIT_COMMAND.test(command)) return "commit"
  if (MUTATING_COMMAND.test(command)) return "mutate"
  return "analyze"
}

function looksVagueIntent(input: string) {
  const text = input.trim().toLowerCase()
  if (!text) return true
  if (text.length < 24) return true
  const vagueVerb = /\b(fix|improve|update|help|do it|make it better|quickly|handle this|clean up)\b/
  const concreteAnchor = /\b(file|path|src|test|workflow|module|component|api|contract|scope|verify|validation|line|function|class)\b/
  return vagueVerb.test(text) && !concreteAnchor.test(text)
}

async function latestUserText(sessionID: string) {
  for await (const message of MessageV2.stream(sessionID)) {
    if (message.info.role !== "user") continue
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) return part.text.trim()
    }
  }
  return ""
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
  return targets.some((target) => candidate === target || candidate.startsWith(`${target}/`) || target.startsWith(`${candidate}/`))
}

function matchesAvoidArea(avoidAreas: string[], candidate: string) {
  return avoidAreas.some((item) => candidate === item || candidate.startsWith(`${item}/`) || item.startsWith(`${candidate}/`))
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
  await createAndPersistApproval({
    runId: input.sessionID,
    type: "workflow_gate",
    risk: input.risk,
    title: input.title,
    reason: input.reason,
    context: input.context,
    source: "system",
  })
}

async function emitWarnIntervention(input: {
  sessionID: string
  reason: string
}) {
  await Bus.publish(Lifecycle.InterventionRequired, {
    runId: input.sessionID,
    reason: input.reason,
    type: "policy_violation",
  })
}

async function registerViolation(input: RuntimeGuardInput, code: string) {
  const fingerprint = violationFingerprint(input, code)
  const session = await Session.get(input.sessionID).catch(() => undefined)
  const current = session?.state_v2?.runtime_guard ?? defaultRuntimeGuardState()
  const nextCount = (current.failureCounts[fingerprint] ?? 0) + 1
  await updateRuntimeGuardState(input.sessionID, (guard) => ({
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
  input: RuntimeGuardInput,
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
    }
  },
) {
  const session = await Session.get(input.sessionID).catch(() => undefined)
  const guardMode = resolveGuardEnforcementMode(session?.state_v2?.guard_enforcement_mode)
  if (!shouldBlockViolation(guardMode, violation.risk)) {
    await emitWarnIntervention({
      sessionID: input.sessionID,
      reason: `${violation.title}: ${violation.reason} Guard mode is warn, so this was recorded as review-needed instead of hard-blocking.`,
    })
    return
  }

  const failure = await registerViolation(input, violation.code)
  const escalated = failure.exceeded
  await ensureIntervention({
    sessionID: input.sessionID,
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
  throw new RuntimeGuardViolationError(escalated ? "loop_break" : violation.code, violation.reason)
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

export async function enforceRuntimeGuard(input: RuntimeGuardInput) {
  const session = await Session.get(input.sessionID).catch(() => undefined)
  if (!session) return

  const sessionContract = session.state_v2?.intent?.contract
  const compiledContract = await ContractGuardian.get(input.sessionID).catch(() => null)
  const scope = normalizeScope(sessionContract)
  const actionClass = classifyActionClass(input.req)
  const mode = session.state_v2?.intent?.activeMode ?? input.agent ?? "build"
  const runState = await RunStore.get(input.sessionID).catch(() => null)
  const lifecycle = runState?.status ?? "running"
  const planQuality = session.state_v2?.plan_quality

  const requiresStrictPlanBeforeMutation =
    planQuality?.decision === "pause" && ["mutate", "commit", "publish"].includes(actionClass)
  if (requiresStrictPlanBeforeMutation) {
    const reason = `Plan quality is ${planQuality?.score ?? 0}/100 with unresolved checks (${(planQuality?.failedChecks ?? []).join(", ")}). DAX blocks mutating actions until the objective, scope, validation, and rollback signals are concrete.`
    await blockViolation(input, {
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

  const scopeHasTargets = normalizeScope(sessionContract).targetFiles.length > 0
  if (!scopeHasTargets && ["mutate", "commit", "publish"].includes(actionClass)) {
    const intentText = await latestUserText(input.sessionID)
    if (looksVagueIntent(intentText)) {
      const reason =
        "The current request is too vague for safe mutation and no scoped execution contract targets were found. Clarify objective, target files/subsystems, and validation before editing."
      await blockViolation(input, {
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
    await blockViolation(input, {
      code: "illegal_transition",
      title: "Mode boundary blocked",
      reason,
      risk: "high",
      context: { toolName: input.toolID, command: input.req.patterns.join(" && ") || undefined },
    })
  }

  const touchedFiles = collectTouchedPaths(input.req)
  for (const relativePath of touchedFiles) {
    const zone = classifyPathZone(relativePath)
    if (zone === "forbidden") {
      const reason = `${relativePath} is outside the allowed workspace or inside a forbidden system/config zone.`
      await blockViolation(input, {
        code: "forbidden_path",
        title: "Forbidden path blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID },
      })
    }
    if (zone === "sensitive") {
      const reason = `${relativePath} is a sensitive path. DAX requires explicit operator approval before reading or mutating secrets, auth, CI, or publish surfaces.`
      await blockViolation(input, {
        code: "sensitive_path",
        title: "Sensitive path requires approval",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID },
      })
    }
    if (matchesAvoidArea(scope.avoidAreas, relativePath)) {
      const reason = `${relativePath} is inside a declared avoid area for this run. Pause and confirm scope before continuing.`
      await blockViolation(input, {
        code: "avoid_area",
        title: "Avoid area blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID, notes: scope.avoidAreas },
      })
    }
    if (!matchesScopedPath(scope.targetFiles, relativePath)) {
      const reason = `${relativePath} falls outside the current contract targets. Review scope before continuing.`
      await blockViolation(input, {
        code: "scope_drift",
        title: "Scope drift blocked",
        reason,
        risk: "critical",
        context: { filePath: relativePath, toolName: input.toolID, notes: scope.targetFiles },
      })
    }
  }

  const currentGuard = session.state_v2?.runtime_guard ?? defaultRuntimeGuardState()
  const nextTouched = new Set(currentGuard.touchedFiles)
  touchedFiles.forEach((item) => nextTouched.add(item))

  const nextFilesTouched = nextTouched.size
  const nextMutatingCommands =
    currentGuard.budget.mutatingCommands + (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish" ? 1 : 0)

  if (nextFilesTouched > currentGuard.budget.maxFilesTouched) {
    const reason = `This run would touch ${nextFilesTouched} files, exceeding the mutation budget of ${currentGuard.budget.maxFilesTouched}. Pause and confirm direction.`
    await blockViolation(input, {
      code: "mutation_budget",
      title: "Mutation budget reached",
      reason,
      risk: "critical",
      context: { toolName: input.toolID, notes: [...nextTouched] },
    })
  }

  if (nextMutatingCommands > currentGuard.budget.maxMutatingCommands) {
    const reason = `This run would exceed the mutating-command budget of ${currentGuard.budget.maxMutatingCommands}. Pause and summarize before continuing.`
    await blockViolation(input, {
      code: "command_budget",
      title: "Mutation command budget reached",
      reason,
      risk: "critical",
      context: { command: input.req.patterns.join(" && ") || undefined, toolName: input.toolID },
    })
  }

  await updateRuntimeGuardState(input.sessionID, (guard) => {
    const next = { ...guard }
    next.budget = {
      ...guard.budget,
      filesTouched: nextFilesTouched,
      mutatingCommands: nextMutatingCommands,
    }
    next.touchedFiles = [...nextTouched]
    if ((actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") && !next.rollbackAnchor) {
      next.rollbackAnchor = {
        baselineRef: undefined,
        createdAt: new Date().toISOString(),
        mutationReceiptIds: input.callID ? [input.callID] : [],
      }
      next.verification = {
        ...next.verification,
        required: true,
      }
    } else if ((actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") && input.callID) {
      next.rollbackAnchor = next.rollbackAnchor
        ? {
            ...next.rollbackAnchor,
            mutationReceiptIds: [...new Set([...(next.rollbackAnchor.mutationReceiptIds ?? []), input.callID])],
          }
        : next.rollbackAnchor
    }
    if (actionClass === "verify") {
      next.verification = {
        required: true,
        satisfied: true,
        receipts: input.callID ? [...new Set([...next.verification.receipts, input.callID])] : next.verification.receipts,
      }
    }
    return next
  })

  const needsBaseline = (actionClass === "mutate" || actionClass === "commit" || actionClass === "publish")
  if (needsBaseline) {
    const baselineRef = await resolveBaselineRef()
    if (baselineRef) {
      await updateRuntimeGuardState(input.sessionID, (guard) => {
        if (!guard.rollbackAnchor || guard.rollbackAnchor.baselineRef) return guard
        return {
          ...guard,
          rollbackAnchor: {
            ...guard.rollbackAnchor,
            baselineRef,
          },
        }
      })
    }
  }

  if (runState) {
    await RunStore.update(input.sessionID, (state) => {
      const next = { ...state }
      next.governance = {
        ...state.governance,
        touchedFiles: [...nextTouched],
        budget: {
          ...state.governance.budget,
          filesTouched: nextFilesTouched,
          mutatingCommands: nextMutatingCommands,
        },
        rollbackAnchor:
          state.governance.rollbackAnchor ??
          ((actionClass === "mutate" || actionClass === "commit" || actionClass === "publish") && session.state_v2?.runtime_guard?.rollbackAnchor
            ? {
                baselineRef: session.state_v2.runtime_guard.rollbackAnchor.baselineRef,
                snapshotId: session.state_v2.runtime_guard.rollbackAnchor.snapshotId,
                createdAt: session.state_v2.runtime_guard.rollbackAnchor.createdAt,
              }
            : state.governance.rollbackAnchor),
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
          compiledContract && session.state_v2?.runtime_guard
            ? deriveCompletionProof({
                contract: compiledContract,
                runState: {
                  ...state,
                  governance: {
                    ...state.governance,
                    touchedFiles: [...nextTouched],
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
                  },
                },
              })
            : state.governance.completionProof,
      }
      return next
    }).catch(() => undefined)
  }

  if (compiledContract) {
    const latestRunState = await RunStore.get(input.sessionID).catch(() => null)
    if (latestRunState) {
      const proof = deriveCompletionProof({
        contract: compiledContract,
        runState: latestRunState,
        artifactCountOverride: session.state_v2?.artifacts?.length ?? latestRunState.artifactIds.length,
      })
      await Session.update(input.sessionID, (draft) => {
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
