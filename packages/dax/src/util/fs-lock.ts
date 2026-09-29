import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

export interface FsLockOptions {
  timeoutMs?: number
  retryIntervalMs?: number
}

export interface FsLockMetadata {
  runId?: string
  scopeType?: "project"
  scopeId?: string
  pid: number
  hostname: string
  createdAt: string
}

export class FsLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FsLockError"
  }
}

export class FsLockStaleError extends FsLockError {
  constructor(scopeId: string, scopeType: "run" | "project" = "run") {
    super(`Stale lock detected for ${scopeType} ${scopeId}`)
    this.name = "FsLockStaleError"
  }
}

export class FsLockTimeoutError extends FsLockError {
  constructor(scopeId: string, scopeType: "run" | "project" = "run") {
    super(`Timeout waiting for lock on ${scopeType} ${scopeId}`)
    this.name = "FsLockTimeoutError"
  }
}

function isLockContentionError(code: string | undefined) {
  if (code === "EEXIST") return true
  return process.platform === "win32" && (code === "EACCES" || code === "EBUSY" || code === "EPERM")
}

async function acquireScopeLock(
  scopeType: "run" | "project",
  scopeId: string,
  options: FsLockOptions = {},
): Promise<{ dispose: () => Promise<void> }> {
  if (!scopeId || scopeId === "." || scopeId === ".." || /[/\\\0]/.test(scopeId)) {
    throw new FsLockError(`Invalid ${scopeType} lock identity`)
  }
  const timeoutMs = options.timeoutMs ?? 5000
  const retryIntervalMs = options.retryIntervalMs ?? 100

  const lockDir = path.join(Global.Path.data, "storage")
  const lockPath = path.join(lockDir, scopeType === "run" ? "run_locks" : "project_locks", `${scopeId}.lock`)

  const metadata: FsLockMetadata = {
    ...(scopeType === "run" ? { runId: scopeId } : { scopeType, scopeId }),
    pid: process.pid,
    hostname: process.env.HOSTNAME || "unknown",
    createdAt: new Date().toISOString(),
  }

  const startTime = Date.now()

  while (true) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true })
      const fd = await fs.open(lockPath, "wx")
      await fd.write(JSON.stringify(metadata, null, 2))
      await fd.close()

      return {
        dispose: async () => {
          try {
            await fs.unlink(lockPath)
          } catch {
            // Lock file already removed
          }
        },
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (isLockContentionError(code)) {
        if (Date.now() - startTime > timeoutMs) {
          throw new FsLockTimeoutError(scopeId, scopeType)
        }

        if (code === "EEXIST") {
          try {
            const existingContent = await fs.readFile(lockPath, "utf-8")
            const existingMeta = JSON.parse(existingContent) as FsLockMetadata

            const isStale = await isLockStale(existingMeta)
            if (isStale) {
              try {
                await fs.unlink(lockPath)
                continue
              } catch {
                // Failed to remove stale lock
              }
            }
          } catch {
            // Failed to read lock file
          }
        }

        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
        continue
      }
      throw error
    }
  }
}

export async function acquireRunLock(runId: string, options: FsLockOptions = {}) {
  return acquireScopeLock("run", runId, options)
}

export async function acquireProjectLock(projectId: string, options: FsLockOptions = {}) {
  return acquireScopeLock("project", projectId, options)
}

async function isLockStale(meta: FsLockMetadata): Promise<boolean> {
  try {
    process.kill(meta.pid, 0)
    return false
  } catch {
    return true
  }
}

export async function tryAcquireRunLock(runId: string): Promise<{ dispose: () => Promise<void> } | null> {
  try {
    return await acquireRunLock(runId, { timeoutMs: 100 })
  } catch (error) {
    if (error instanceof FsLockTimeoutError) {
      return null
    }
    throw error
  }
}
