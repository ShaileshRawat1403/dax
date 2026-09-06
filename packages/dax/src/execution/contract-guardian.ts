import { isValidContract, type ExecutionContract } from "./execution-contract"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { RunStore } from "@/state/run-store"
import { getRunAuthority, hasRunEvents } from "@/state/events/run-event-store"
import { Identifier } from "@/id/id"

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
    const contract = await Storage.read<unknown>(contractPath(runId))
    if (!isValidContract(contract)) {
      throw new Error(`Invalid ExecutionContract stored for run ${runId}`)
    }
    return contract
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return null
    }
    log.error("failed to read execution contract", { runId, error })
    throw error
  }
}

/**
 * Resolves the immutable contract that governs execution in a session.
 * An explicit governing run reference is authoritative: its absence or a
 * failed read is never reinterpreted as an ungoverned child session.
 */
export async function resolveExecutionAuthority(
  sessionId: string,
  governingRunId?: string,
): Promise<{ governingRunId?: string; contract: ExecutionContract | null }> {
  const hasExplicitAuthority = governingRunId !== undefined
  const authorityRunId = hasExplicitAuthority ? Identifier.schema("session").parse(governingRunId) : sessionId
  const contract = await readContract(authorityRunId)

  if (hasExplicitAuthority && !contract) {
    throw new Error(`Governing ExecutionContract not found for run ${authorityRunId}`)
  }

  if (!contract) {
    return { contract: null }
  }

  if (contract.runId !== authorityRunId) {
    throw new Error(
      `ExecutionContract for storage run ${authorityRunId} declares mismatched run ${contract.runId}`,
    )
  }

  return { governingRunId: authorityRunId, contract }
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
    const authority = await getRunAuthority(runId)

    // Event authority begins when the canonical authority marker is written,
    // before any legacy RunStore compatibility row exists. That marker is the
    // durable decision about which lifecycle owns this run, so an existing
    // contract is locked as soon as it is present.
    if (authority === "event-log") {
      return false
    }

    // A genuinely unmarked pre-run has neither authority marker nor canonical
    // events. If canonical events exist without their marker, the authority is
    // uncertain rather than pre-run; a changed contract must stay locked.
    if (authority === null && (await hasRunEvents(runId))) {
      log.warn("canonical events exist without a run authority marker", { runId })
      return false
    }

    const state = await RunStore.get(runId)

    if (!state) {
      return true // No run state yet - can write
    }

    // Once the run moves past "created", the contract is locked
    return state.status === "created"
  } catch (error) {
    // A failed authority read must not turn into permission to alter an
    // existing contract. The caller still allows an idempotent rewrite because
    // it compares the existing and proposed contract hashes after this returns.
    log.warn("failed to establish run authority for contract mutability", { runId, error })
    return false
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
    // Integrity is checked here rather than at the call sites. It previously
    // had none: verifyContractIntegrity and this namespace's `verify` were
    // exported and never called, so a stored contract missing contractId,
    // runId or workflowClass was handed to the runtime guard and used. Folding
    // the check into the single load path makes the control actually run
    // everywhere a contract is read, with no call site left to forget it.
    const result = await verifyContractIntegrity(runId)
    if (result.valid) return result.contract ?? null
    if (result.error !== "Contract not found") {
      log.warn("rejected malformed execution contract", { runId, error: result.error })
    }
    return null
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
