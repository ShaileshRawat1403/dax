import { ExecutionContract } from "./execution-contract"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { RunStore } from "@/state/run-store"
import { isTerminalStatus } from "@/state/run-state"

const log = Log.create({ service: "contract-guardian" })

const CONTRACT_MUTATION_ERROR = "ExecutionContract is immutable after run initialization"

export class ContractImmutabilityError extends Error {
  constructor(
    public readonly contractId: string,
    public readonly operation: string,
  ) {
    super(`${CONTRACT_MUTATION_ERROR}: cannot ${operation} on contract ${contractId}`)
    this.name = "ContractImmutabilityError"
  }
}

// Read contract
export async function readContract(runId: string): Promise<ExecutionContract | null> {
  try {
    return await Storage.read<ExecutionContract>(contractPath(runId))
  } catch {
    return null
  }
}

// Write contract only if run hasn't started or if it hasn't changed
export async function writeContractIfNotStarted(runId: string, contract: ExecutionContract): Promise<void> {
  const existing = await readContract(runId)

  if (existing) {
    const canWrite = await canModifyContract(runId)
    if (!canWrite) {
      // Check if it's the exact same contract being re-written (idempotent)
      const existingHash = await hashContract(existing)
      const newHash = await hashContract(contract)

      if (existingHash !== newHash) {
        throw new ContractImmutabilityError(contract.contractId, "modify")
      }
      return // Same contract, ignore write
    }
  }

  await Storage.write(contractPath(runId), contract)
  log.info("contract initialized", { runId, contractId: contract.contractId })
}

async function canModifyContract(runId: string): Promise<boolean> {
  try {
    const state = await RunStore.get(runId)

    if (!state) {
      return true // No run state yet - can write
    }

    // Once the run moves past "created", the contract is locked
    return state.status === "created"
  } catch {
    return true // Safe default: allow
  }
}

export async function verifyContractIntegrity(runId: string): Promise<{
  valid: boolean
  contract?: ExecutionContract
  error?: string
}> {
  const contract = await readContract(runId)

  if (!contract) {
    return { valid: false, error: "Contract not found" }
  }

  if (!contract.contractId || !contract.runId || !contract.workflowClass) {
    return { valid: false, error: "Contract missing required fields" }
  }

  return { valid: true, contract }
}

async function hashContract(contract: ExecutionContract): Promise<string> {
  const data = JSON.stringify(contract)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  }

  // Fallback for environments without crypto.subtle (like some older Node versions)
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const chr = data.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0 // Convert to 32bit int
  }
  return hash.toString(16)
}

function contractPath(runId: string): string[] {
  return ["execution_contract", Instance.project.id, runId]
}

export namespace ContractGuardian {
  /**
   * Gets the execution contract for a run.
   * @param runId - Run ID to get contract for
   * @returns Execution contract or null
   */
  export async function get(runId: string): Promise<ExecutionContract | null> {
    return readContract(runId)
  }

  /**
   * Creates an execution contract for a run if not already started.
   * @param runId - Run ID
   * @param contract - Contract to create
   */
  export async function create(runId: string, contract: ExecutionContract): Promise<void> {
    return writeContractIfNotStarted(runId, contract)
  }

  /**
   * Verifies the integrity of an execution contract.
   * @param runId - Run ID to verify
   * @returns true if contract is valid
   */
  export async function verify(runId: string): Promise<boolean> {
    const result = await verifyContractIntegrity(runId)
    return result.valid
  }
}
