import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { assertReviewedImage } from "@/capability/reviewed-authority"
import { ReviewedRunError } from "@/capability/reviewed-run-contract"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Permission } from "@/governance"
import type { Config } from "@/config/config"
import type { CreateRunRequest, CreateRunResponse } from "@/server/run-contract"
import { compileWithRunId } from "./compiler"
import type { ExecutionContract, GoverningExecutionContract } from "./execution-contract"
import { WorkflowRegistry } from "@/workflows/registry"
import { isFixedWorkflow } from "@/workflows/types"
import { Tracer } from "@/runtime/telemetry"
import { evaluatePlanQuality } from "./plan-quality-gate"
import { resolveGuardEnforcementMode } from "./guard-mode"
import { createAndPersistApproval } from "@/approval/approval-transitions"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { ShadowAuditor } from "./shadow-auditor"

import { ContractGuardian } from "./contract-guardian"
import { GrantReview, type GrantReviewRevision } from "@/capability/grant-review"
import { proposeGrants } from "@/capability/grant-proposal"
import { captureReviewSnapshot } from "@/capability/grant-review-snapshot"
import { RunLifecycle } from "@/state/run-lifecycle"
import { createEventAuthorityRun, transitionEventAuthority } from "@/state/events/event-transitions"

/**
 * Event authority used to cover draft_and_approve and worker_run only. The other
 * three workflow classes wrote no run events at all, so half the runtime was
 * invisible to replay, recovery and audit — and every conformance invariant had
 * to be satisfied twice, once per lifecycle, with only one of them ever checked.
 *
 * Kept as a function rather than deleted outright so the intent stays legible:
 * every run is event-authority, unconditionally.
 */
export function isEventAuthorityPilot(_workflowClass: string): true {
  return true
}

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
  successorOf?: string
}

const log = Log.create({ service: "run-factory" })

export interface RunFactoryInput {
  request: CreateRunRequest
  availableTools?: string[]
}

export interface RunFactoryResult {
  runId: string
  contract: ExecutionContract
  response: CreateRunResponse
  warnings: string[]
}

async function writeContract(runId: string, contract: ExecutionContract): Promise<void> {
  await ContractGuardian.create(runId, contract)
}

async function readContract(runId: string): Promise<GoverningExecutionContract | undefined> {
  const contract = await ContractGuardian.get(runId)
  return contract || undefined
}

export async function writeRunMeta(runId: string, meta: RunMeta): Promise<void> {
  await Storage.write(["run_meta", Instance.project.id, runId], meta)
}

function sessionPermissionFromPreset(input: CreateRunRequest): Permission.Ruleset | undefined {
  const approvalMode = input.personaPreset?.approvalMode
  const riskLevel = input.personaPreset?.riskLevel

  if (!approvalMode && !riskLevel) {
    return undefined
  }

  // Typed as the config shape fromConfig actually consumes, so the object
  // built below is checked against it instead of cast at the call.
  const permission: Config.Permission = {}

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

  return Object.keys(permission).length > 0 ? Permission.fromConfig(permission) : undefined
}

function buildPromptContext(contract: GoverningExecutionContract): string {
  const parts: string[] = []

  parts.push(`## Execution Contract`)
  parts.push(`Workflow: ${contract.workflowClass}`)
  parts.push(`Risk Level: ${contract.riskLevel}`)
  parts.push(`Execution Mode: ${contract.executionMode}`)
  parts.push(``)
  parts.push(`## Intent`)
  parts.push(contract.intent)
  parts.push(``)

  if (contract.toolAllowlist.length > 0) {
    parts.push(`## Available Tools`)
    parts.push(contract.toolAllowlist.join(", "))
    parts.push(``)
  }

  if (contract.expectedOutputs.length > 0) {
    parts.push(`## Expected Outputs`)
    for (const output of contract.expectedOutputs) {
      parts.push(`- ${output.type}: ${output.description}`)
    }
    parts.push(``)
  }

  if (contract.approvalPolicy.mode === "approval_gated") {
    parts.push(`## Approval Policy`)
    parts.push(`Approvals required for: ${contract.approvalPolicy.toolCategories?.join(", ") ?? "high-risk actions"}`)
    parts.push(``)
  }

  return parts.join("\n")
}

export async function startExecution(runId: string, contract: GoverningExecutionContract): Promise<void> {
  if (!contract.intent.trim()) {
    log.info("empty intent, skipping execution", { runId })
    return
  }

  const model =
    contract.providerHint && contract.modelHint
      ? {
          providerID: contract.providerHint,
          modelID: contract.modelHint,
        }
      : undefined

  const promptContext = buildPromptContext(contract)

  SessionPrompt.prompt({
    sessionID: runId,
    model,
    completionPolicy: "on_provider_stop",
    parts: [
      {
        type: "text",
        text: promptContext,
      },
      {
        type: "text",
        text: `\n\n## User Request\n${contract.intent}`,
      },
    ],
  }).catch(async (error) => {
    log.error("failed to start execution", { error, runId, contractId: contract.contractId })
    // The run was moved to `running` before this prompt was dispatched, so a
    // rejection here leaves durable canonical state claiming an execution that
    // has already died. Drive the ordinary canonical failure transition rather
    // than recording the death anywhere else: `run_failed` is the existing
    // vocabulary, the reducer no-ops if the run already reached a terminal
    // state, and the original reason travels in the event payload.
    await RunLifecycle.transition(runId, "failed", "run_failed", {
      error: {
        code: "execution_start_failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    }).catch((transitionError) => {
      log.error("failed to record execution start failure", {
        error: transitionError,
        cause: error,
        runId,
        contractId: contract.contractId,
      })
    })
  })
}

export async function createRunFromContract(input: RunFactoryInput): Promise<RunFactoryResult> {
  if (
    input.request.workerConstraints?.conversation &&
    (input.request.workflowHint !== "worker_run" || input.request.personaPreset?.providerHint !== "worker:antigravity")
  ) {
    throw new Error("Conversational worker execution requires the explicit AGY worker_run path.")
  }
  const title = input.request.intent.input.split("\n")[0]?.trim() || "External run"
  const permission = sessionPermissionFromPreset(input.request)

  const session = await Session.create({ title, permission })

  const { contract, warnings } = compileWithRunId(input, session.id)
  contract.runId = session.id
  const guardMode = resolveGuardEnforcementMode()
  const planQuality = evaluatePlanQuality(contract)

  await writeContract(session.id, contract)
  await Session.bindGoverningRun(session.id, session.id)

  const isEventPilot = true

  // Deliberately uninitialised. Every branch below assigns it before the
  // response is built, and the status reaches the API caller, so a future
  // branch that forgets should be a compile error rather than a silent
  // "created" for a run that is already executing.
  let finalStatus: CreateRunResponse["status"]

  if (isEventPilot) {
    await createEventAuthorityRun(
      session.id,
      contract.contractId,
      contract.runtimePolicy?.postconditions?.verificationRequired === true,
      guardMode,
    )
  }

  await Session.update(session.id, (draft) => {
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
      plan_quality: planQuality,
      completion_proof: current?.completion_proof,
      guard_enforcement_mode: guardMode,
    }
  })

  await writeRunMeta(session.id, {
    sourceSystem: input.request.metadata?.source ?? "api",
    initiatedBy: input.request.metadata?.initiatedBy,
    workspaceId: input.request.metadata?.workspaceId,
    projectId: input.request.metadata?.projectId,
    chatId: input.request.metadata?.chatId,
    workflowId: input.request.metadata?.workflowId,
    targeting: input.request.metadata?.targeting,
    contractId: contract.contractId,
    workflowClass: contract.workflowClass,
  })

  Tracer.runCreated(session.id, contract.workflowClass, contract.executionMode)
  Tracer.contractCompiled(session.id, contract.contractId, contract.riskLevel)

  // Kick off background shadow auditor
  void ShadowAuditor.analyze(session.id, input.request.intent.input, contract)

  const requiresPauseForPlanQuality = planQuality.decision === "pause" && guardMode === "enforce"
  if (planQuality.decision === "pause") {
    const note = `Plan quality gate flagged this run (${planQuality.score}/100): ${planQuality.failedChecks.join(", ")}`
    warnings.push(note)
    if (guardMode !== "enforce") {
      await Bus.publish(Lifecycle.InterventionRequired, {
        runId: session.id,
        reason: `Plan quality warning (warn mode): ${planQuality.failedChecks.join(", ")}.`,
        type: "policy_violation",
      })
    }
  }

  if (isFixedWorkflow(contract.workflowClass)) {
    const workflow = WorkflowRegistry.create(contract.workflowClass, {
      runId: session.id,
      contract,
    })

    if (workflow && !requiresPauseForPlanQuality) {
      await transitionEventAuthority(session.id, "queued", "execution_queued", {})
      await transitionEventAuthority(session.id, "running", "workflow_started", {})
      finalStatus = "running"
      workflow.execute().catch((error) => {
        log.error("workflow execution failed", {
          error,
          runId: session.id,
          contractId: contract.contractId,
        })
      })
    } else {
      if (requiresPauseForPlanQuality) {
        await transitionEventAuthority(session.id, "queued", "execution_queued", {})
        await transitionEventAuthority(session.id, "running", "execution_started", {})
        await transitionEventAuthority(session.id, "waiting_approval", "plan_quality_gate", {})
        finalStatus = "waiting_approval"
      } else {
        finalStatus = "created"
      }
    }
  } else {
    if (planQuality.decision === "pause" && guardMode === "enforce") {
      await transitionEventAuthority(session.id, "queued", "execution_queued", {})
      await transitionEventAuthority(session.id, "running", "execution_started", {})
      await transitionEventAuthority(session.id, "waiting_approval", "plan_quality_gate", {})
      finalStatus = "waiting_approval"
    } else {
      // Generic runs must advance lifecycle before prompt execution so server snapshots
      // do not remain stuck at "created/compiled" while the model is already running.
      await transitionEventAuthority(session.id, "queued", "execution_queued", {})
      await transitionEventAuthority(session.id, "running", "execution_started", {})
      await startExecution(session.id, contract)
      finalStatus = "running"
    }
  }

  // The canonical request itself moves the run into waiting_approval. Append
  // it only after the ordinary queued/running birth sequence is durable.
  if (requiresPauseForPlanQuality) {
    await createAndPersistApproval({
      runId: session.id,
      type: "workflow_gate",
      risk: "high",
      title: "Plan quality gate paused execution",
      reason: `Execution paused until operator review. Missing plan signals: ${planQuality.failedChecks.join(", ")}.`,
      source: "system",
      context: { notes: planQuality.guidance },
    })
  }

  const response: CreateRunResponse = {
    runId: session.id,
    status: finalStatus,
    createdAt: new Date(session.time.created).toISOString(),
    workflowHint: contract.workflowHint,
    workflowHintAccepted: contract.workflowHintAccepted,
    workflowClass: contract.workflowClass,
    warnings,
  }

  return {
    runId: session.id,
    contract,
    response,
    warnings,
  }
}

/**
 * Create a run that executes only under operator-reviewed capability grants.
 * The restricted generic operator API additionally requires pure preflight.
 *
 * Canonical reviewed intent and a private reservation precede the publicly
 * usable, explicitly governed session. A creation crash or lost reservation
 * cannot restore ordinary authority. No v1 contract is written to the guardian.
 * Review, publication and activation remain necessary for execution under the
 * common compiled-image gate.
 */
export async function createGrantReviewedRun(
  input: RunFactoryInput,
  options?: {
    writeScope?: { roots: string[]; reviewed: boolean }
    /** Capability IDs whose external, unattested implementation the operator accepts. */
    acknowledgedExternal?: string[]
    /** MCP source selectors the operator chose for reads with no enumerable identity. */
    sourceSelections?: { server: string; family: "tool" | "resource" | "prompt" }[]
    /** Grant subjects to be asked about each time rather than allowed. */
    askSubjects?: string[]
    /** Agents the operator allows each delegation capability to start. */
    delegations?: { capabilityId: string; agents: string[] }[]
  },
  policy?: { restrictedGeneric: true },
): Promise<{ runId: string; revision: GrantReviewRevision }> {
  const title = input.request.intent.input.split("\n")[0]?.trim() || "External run"
  // Compile before any durable state, then establish canonical reviewed intent
  // before publishing a usable session. A lost private reservation can never
  // turn a creation interrupted before the first request into an ordinary run.
  const runId = Identifier.descending("session")
  const { contract } = compileWithRunId(input, runId)
  if (policy?.restrictedGeneric) {
    if (input.request.metadata?.allowLegacyFallback) throw new ReviewedRunError("legacy_fallback_conflict", 400)
    if (input.request.workflowHint !== "generic" || contract.workflowClass !== "generic") {
      throw new ReviewedRunError("generic_workflow_required", 400)
    }
    if (input.request.workerConstraints !== undefined || contract.providerHint?.startsWith("worker:")) {
      throw new ReviewedRunError("worker_unsupported", 400)
    }
    if (contract.runtimePolicy?.postconditions?.verificationRequired) {
      throw new ReviewedRunError("verification_unsupported", 400)
    }
    try {
      assertReviewedImage(runId)
    } catch {
      throw new ReviewedRunError("enforcing_image_required", 400)
    }
  }
  await createEventAuthorityRun(
    runId,
    contract.contractId,
    contract.runtimePolicy?.postconditions?.verificationRequired === true,
    resolveGuardEnforcementMode(),
    "reviewed_grants",
  )
  await transitionEventAuthority(runId, "queued", "execution_queued", {})
  await GrantReview.reserve(runId, contract.contractId)
  const session = await Session.createNext({
    id: runId,
    governingRunId: runId,
    directory: Instance.directory,
    title,
    permission: sessionPermissionFromPreset(input.request),
  })

  const proposal = await proposeGrants({
    runId: session.id,
    contract,
    snapshot: await captureReviewSnapshot(contract),
    inputs: {
      toolAllowlist: contract.toolAllowlist,
      toolBlocklist: contract.toolBlocklist,
      workflowClass: contract.workflowClass,
      ...(contract.providerHint ? { providerHint: contract.providerHint } : {}),
      ...(options?.writeScope ? { writeScope: options.writeScope } : {}),
      ...(options?.acknowledgedExternal ? { acknowledgedExternal: options.acknowledgedExternal } : {}),
      ...(options?.sourceSelections ? { sourceSelections: options.sourceSelections } : {}),
      ...(options?.askSubjects ? { askSubjects: options.askSubjects } : {}),
      ...(options?.delegations ? { delegations: options.delegations } : {}),
    },
  })
  const revision = await GrantReview.begin(session.id, proposal)
  return { runId: session.id, revision }
}

export async function getContractForRun(runId: string): Promise<GoverningExecutionContract | undefined> {
  return readContract(runId)
}

export async function hasContract(runId: string): Promise<boolean> {
  const contract = await readContract(runId)
  return contract !== undefined
}

export namespace RunFactory {
  /**
   * Creates a new run from an execution contract.
   * @param input - Run factory input with contract and metadata
   * @returns Created run factory result
   */
  export async function create(input: RunFactoryInput): Promise<RunFactoryResult> {
    return createRunFromContract(input)
  }

  /**
   * Gets the execution contract for a run.
   * @param runId - Run ID to get contract for
   * @returns Execution contract or undefined
   */
  export async function getContract(runId: string): Promise<GoverningExecutionContract | undefined> {
    return getContractForRun(runId)
  }

  /**
   * Checks if a run has an execution contract.
   * @param runId - Run ID to check
   * @returns true if contract exists
   */
  export async function hasContract(runId: string): Promise<boolean> {
    return hasContract(runId)
  }
}
