import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Permission } from "@/governance"
import type { Config } from "@/config/config"
import type { CreateRunRequest, CreateRunResponse } from "@/server/run-contract"
import { compileWithRunId } from "./compiler"
import type { ExecutionContract } from "./execution-contract"
import { RunStore } from "@/state/run-store"
import { Transitions } from "@/state/transitions"
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
import {
  createEventAuthorityRun,
  transitionEventAuthority,
} from "@/state/events/event-transitions"

const EVENT_AUTHORITY_PILOT_WORKFLOWS = ["draft_and_approve", "worker_run"] as const
type EventAuthorityPilotWorkflow = (typeof EVENT_AUTHORITY_PILOT_WORKFLOWS)[number]

export function isEventAuthorityPilot(workflowClass: string): workflowClass is EventAuthorityPilotWorkflow {
  return (EVENT_AUTHORITY_PILOT_WORKFLOWS as readonly string[]).includes(workflowClass)
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

async function readContract(runId: string): Promise<ExecutionContract | undefined> {
  const contract = await ContractGuardian.get(runId)
  return contract || undefined
}

async function writeRunMeta(runId: string, meta: RunMeta): Promise<void> {
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

function buildPromptContext(contract: ExecutionContract): string {
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

async function startExecution(runId: string, contract: ExecutionContract): Promise<void> {
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
  }).catch((error) => {
    log.error("failed to start execution", { error, runId, contractId: contract.contractId })
  })
}

export async function createRunFromContract(input: RunFactoryInput): Promise<RunFactoryResult> {
  const title = input.request.intent.input.split("\n")[0]?.trim() || "External run"
  const permission = sessionPermissionFromPreset(input.request)

  const session = await Session.create({ title, permission })

  const { contract, warnings } = compileWithRunId(input, session.id)
  contract.runId = session.id
  const guardMode = resolveGuardEnforcementMode()
  const planQuality = evaluatePlanQuality(contract)

  await writeContract(session.id, contract)

  const isEventPilot = isEventAuthorityPilot(contract.workflowClass)

  // Deliberately uninitialised. Every branch below assigns it before the
  // response is built, and the status reaches the API caller, so a future
  // branch that forgets should be a compile error rather than a silent
  // "created" for a run that is already executing.
  let finalStatus: CreateRunResponse["status"]

  if (isEventPilot) {
    await createEventAuthorityRun(session.id, contract.contractId)
  } else {
    await RunStore.create(session.id, contract.contractId)
    await Transitions.transition(session.id, "compiled", "contract_compiled")
    await RunStore.update(session.id, (state) => ({
      ...state,
      governance: {
        ...state.governance,
        guardEnforcementMode: guardMode,
        planQuality,
      },
    }))
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
    if (guardMode === "enforce") {
      await createAndPersistApproval({
        runId: session.id,
        type: "workflow_gate",
        risk: "high",
        title: "Plan quality gate paused execution",
        reason: `Execution paused until operator review. Missing plan signals: ${planQuality.failedChecks.join(", ")}.`,
        source: "system",
        context: {
          notes: planQuality.guidance,
        },
      })
    } else {
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
      if (isEventPilot) {
        await transitionEventAuthority(session.id, "queued", "execution_queued", {})
        await transitionEventAuthority(session.id, "running", "workflow_started", {})
      } else {
        await Transitions.transition(session.id, "queued", "execution_queued")
        await Transitions.transition(session.id, "running", "workflow_started")
      }
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
        await Transitions.transition(session.id, "queued", "execution_queued")
        await Transitions.transition(session.id, "running", "execution_started")
        await Transitions.transition(session.id, "waiting_approval", "plan_quality_gate")
        finalStatus = "waiting_approval"
      } else {
        finalStatus = "created"
      }
    }
  } else {
    if (planQuality.decision === "pause" && guardMode === "enforce") {
      await Transitions.transition(session.id, "queued", "execution_queued")
      await Transitions.transition(session.id, "running", "execution_started")
      await Transitions.transition(session.id, "waiting_approval", "plan_quality_gate")
      finalStatus = "waiting_approval"
    } else {
      // Generic runs must advance lifecycle before prompt execution so server snapshots
      // do not remain stuck at "created/compiled" while the model is already running.
      await Transitions.transition(session.id, "queued", "execution_queued")
      await Transitions.transition(session.id, "running", "execution_started")
      await startExecution(session.id, contract)
      finalStatus = "running"
    }
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

export async function getContractForRun(runId: string): Promise<ExecutionContract | undefined> {
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
  export async function getContract(runId: string): Promise<ExecutionContract | undefined> {
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
