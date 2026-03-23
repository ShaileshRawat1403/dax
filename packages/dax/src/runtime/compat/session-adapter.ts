import { Log } from "@/util/log"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { CreateRunRequest } from "@/server/run-contract"

const log = Log.create({ service: "session-adapter" })

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

export interface AdapterContext {
  contract: ExecutionContract
  meta: RunMeta
}

export interface SessionAdapterConfig {
  wrapPrompts: boolean
  enforceToolAllowlist: boolean
  injectContractContext: boolean
}

const DEFAULT_CONFIG: SessionAdapterConfig = {
  wrapPrompts: true,
  enforceToolAllowlist: true,
  injectContractContext: true,
}

export function buildSessionPrompt(contract: ExecutionContract, userIntent: string): string {
  const parts: string[] = []

  if (contract.executionMode === "approval_gated") {
    parts.push(`[APPROVAL REQUIRED] This workflow requires approval before executing high-risk actions.`)
    parts.push(``)
  }

  if (contract.executionMode === "manual") {
    parts.push(`[MANUAL MODE] This workflow requires explicit manual approval for all actions.`)
    parts.push(``)
  }

  parts.push(`Workflow: ${contract.workflowClass}`)
  parts.push(`Risk Level: ${contract.riskLevel}`)
  parts.push(``)

  if (contract.toolAllowlist.length > 0) {
    parts.push(`Available tools: ${contract.toolAllowlist.join(", ")}`)
    parts.push(``)
  }

  parts.push(`## Task`)
  parts.push(userIntent)

  return parts.join("\n")
}

export function extractIntentFromLegacyRequest(request: CreateRunRequest): string {
  return request.intent.input
}

export function adaptLegacyPersonaPreset(request: CreateRunRequest): Partial<ExecutionContract> | undefined {
  if (!request.personaPreset) return undefined

  const { approvalMode, riskLevel, providerHint, modelHint } = request.personaPreset

  if (!approvalMode && !riskLevel && !providerHint && !modelHint) {
    return undefined
  }

  return {
    providerHint,
    modelHint,
  }
}

export function createCompatibilityContext(contract: ExecutionContract, meta: RunMeta): AdapterContext {
  return {
    contract,
    meta,
  }
}

export function shouldUseCompatibilityPath(request: CreateRunRequest): boolean {
  return (
    request.metadata?.source === "soothsayer" ||
    request.metadata?.source === "cli" ||
    request.metadata?.source === "api" ||
    request.personaPreset?.eli12 === true
  )
}

export function createSessionAdapter(config: Partial<SessionAdapterConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  return {
    config: cfg,

    adaptRequest(request: CreateRunRequest): CreateRunRequest {
      if (!cfg.injectContractContext) {
        return request
      }

      log.info("adapting request for compatibility", {
        source: request.metadata?.source,
        hasPersona: !!request.personaPreset,
      })

      return request
    },

    buildPrompt(contract: ExecutionContract, intent: string): string {
      if (!cfg.wrapPrompts) {
        return intent
      }

      return buildSessionPrompt(contract, intent)
    },

    enforceToolAllowlist(contract: ExecutionContract, requestedTool: string): boolean {
      if (!cfg.enforceToolAllowlist) {
        return true
      }

      if (contract.toolBlocklist.includes(requestedTool)) {
        log.warn("tool blocked by contract blocklist", {
          tool: requestedTool,
          contractId: contract.contractId,
        })
        return false
      }

      if (contract.toolAllowlist.length > 0 && !contract.toolAllowlist.includes(requestedTool)) {
        log.warn("tool not in contract allowlist", {
          tool: requestedTool,
          contractId: contract.contractId,
          allowlist: contract.toolAllowlist,
        })
        return false
      }

      return true
    },
  }
}

export namespace SessionAdapter {
  export function create(config?: Partial<SessionAdapterConfig>) {
    return createSessionAdapter(config)
  }

  export function buildPrompt(contract: ExecutionContract, intent: string): string {
    return buildSessionPrompt(contract, intent)
  }

  export function shouldUseCompatibility(request: CreateRunRequest): boolean {
    return shouldUseCompatibilityPath(request)
  }
}
