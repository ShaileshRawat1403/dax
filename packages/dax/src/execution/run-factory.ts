import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Permission } from "@/governance"
import type { CreateRunRequest, CreateRunResponse } from "@/server/run-contract"
import { compileWithRunId } from "./compiler"
import type { ExecutionContract } from "./execution-contract"
import { RunStore } from "@/state/run-store"
import { Transitions } from "@/state/transitions"
import { WorkflowRegistry } from "@/workflows/registry"
import { isFixedWorkflow } from "@/workflows/types"
import { Tracer } from "@/runtime/telemetry"

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
  await Storage.write(["execution_contract", Instance.project.id, runId], contract)
}

async function readContract(runId: string): Promise<ExecutionContract | undefined> {
  return Storage.read<ExecutionContract>(["execution_contract", Instance.project.id, runId]).catch(() => undefined)
}

async function buildRunMeta(request: CreateRunRequest, runId: string): Promise<RunMeta> {
  return {
    sourceSystem: request.metadata?.source ?? "api",
    initiatedBy: request.metadata?.initiatedBy,
    workspaceId: request.metadata?.workspaceId,
    projectId: request.metadata?.projectId,
    chatId: request.metadata?.chatId,
    workflowId: request.metadata?.workflowId,
    targeting: request.metadata?.targeting,
    contractId: `ctr_${Identifier.create("session", false)}`,
    workflowClass: "generic",
  }
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

  await writeContract(session.id, contract)

  const runState = await RunStore.create(session.id, contract.contractId)
  await Transitions.transition(session.id, "compiled", "contract_compiled")

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

  if (isFixedWorkflow(contract.workflowClass)) {
    const workflow = WorkflowRegistry.create(contract.workflowClass, {
      runId: session.id,
      contract,
    })

    if (workflow) {
      await Transitions.transition(session.id, "queued", "execution_queued")
      await Transitions.transition(session.id, "running", "workflow_started")
      workflow.execute().catch((error) => {
        log.error("workflow execution failed", {
          error,
          runId: session.id,
          contractId: contract.contractId,
        })
      })
    }
  } else {
    await startExecution(session.id, contract)
  }

  const response: CreateRunResponse = {
    runId: session.id,
    status: "created",
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
  export async function create(input: RunFactoryInput): Promise<RunFactoryResult> {
    return createRunFromContract(input)
  }

  export async function getContract(runId: string): Promise<ExecutionContract | undefined> {
    return getContractForRun(runId)
  }

  export async function hasContract(runId: string): Promise<boolean> {
    return hasContract(runId)
  }
}
