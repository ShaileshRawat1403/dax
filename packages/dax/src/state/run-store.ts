import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { RunState } from "./run-state"
import { createInitialRunState } from "./run-state"

const log = Log.create({ service: "run-store" })

async function storagePath(runId: string): Promise<string[]> {
  return ["run_state", Instance.project.id, runId]
}

export async function readRunState(runId: string): Promise<RunState | null> {
  try {
    const state = await Storage.read<RunState>(await storagePath(runId))
    return state
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return null
    }
    log.error("failed to read run state", { error, runId })
    throw error
  }
}

export async function writeRunState(runId: string, state: RunState): Promise<void> {
  try {
    await Storage.write(await storagePath(runId), state)
  } catch (error) {
    log.error("failed to write run state", { error, runId })
    throw error
  }
}

export async function createRunState(runId: string, contractId: string): Promise<RunState> {
  const state = createInitialRunState(runId, contractId)
  await writeRunState(runId, state)
  log.info("created run state", { runId, contractId })
  return state
}

export async function hasRunState(runId: string): Promise<boolean> {
  const state = await readRunState(runId)
  return state !== null
}

export async function removeRunState(runId: string): Promise<void> {
  try {
    await Storage.remove(await storagePath(runId))
    log.info("removed run state", { runId })
  } catch (error) {
    if (!Storage.NotFoundError.isInstance(error)) {
      throw error
    }
  }
}

export async function updateRunState(runId: string, updater: (state: RunState) => RunState): Promise<RunState> {
  const current = await readRunState(runId)
  if (!current) {
    throw new Error(`Run state not found: ${runId}`)
  }
  const updated = updater(current)
  updated.updatedAt = new Date().toISOString()
  await writeRunState(runId, updated)
  return updated
}

export async function listRunStates(limit = 100): Promise<RunState[]> {
  const prefix = ["run_state", Instance.project.id]
  const keys = await Storage.list(prefix)
  const results: RunState[] = []

  for (const key of keys.slice(0, limit)) {
    const runId = key[key.length - 1]
    try {
      const state = await readRunState(runId)
      if (state) {
        results.push(state)
      }
    } catch {
      // skip invalid entries
    }
  }

  return results
}

export async function getRunStateOrCreate(runId: string, contractId: string): Promise<RunState> {
  const existing = await readRunState(runId)
  if (existing) {
    return existing
  }
  return createRunState(runId, contractId)
}

export namespace RunStore {
  export async function get(runId: string): Promise<RunState | null> {
    return readRunState(runId)
  }

  export async function save(runId: string, state: RunState): Promise<void> {
    return writeRunState(runId, state)
  }

  export async function create(runId: string, contractId: string): Promise<RunState> {
    return createRunState(runId, contractId)
  }

  export async function exists(runId: string): Promise<boolean> {
    return hasRunState(runId)
  }

  export async function remove(runId: string): Promise<void> {
    return removeRunState(runId)
  }

  export async function update(runId: string, updater: (state: RunState) => RunState): Promise<RunState> {
    return updateRunState(runId, updater)
  }

  export async function list(limit?: number): Promise<RunState[]> {
    return listRunStates(limit)
  }
}
