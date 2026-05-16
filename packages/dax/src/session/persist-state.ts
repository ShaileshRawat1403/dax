import * as fs from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import type { SessionSnapshot, GraphStatus } from "./snapshot-types"
import type { SessionState } from "./state-types"

const log = Log.create({ service: "session-persist" })

const SESSION_DIR = ".dax/sessions"
const writes = new Map<string, Promise<void>>()

type SaveSnapshotOptions = {
  cwd?: string
  graphStatus?: GraphStatus
  workflowId?: string
}

export function getSessionDirectory(sessionId: string, cwd = process.cwd()): string {
  return path.join(cwd, SESSION_DIR, sessionId)
}

export function saveSnapshot(
  sessionId: string,
  state: SessionState,
  options?: SaveSnapshotOptions,
): Promise<void> {
  const snapshot: SessionSnapshot = {
    sessionId,
    workflowId: options?.workflowId,
    savedAt: new Date().toISOString(),
    state,
    graphStatus: options?.graphStatus,
  }

  const cwd = options?.cwd ?? process.cwd()
  const dirPath = getSessionDirectory(sessionId, cwd)
  const filePath = path.join(dirPath, "session-snapshot.json")
  const previous = writes.get(filePath) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(dirPath, { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2))
    })
    .finally(() => {
      if (writes.get(filePath) === next) writes.delete(filePath)
    })
  writes.set(filePath, next)
  return next
}

export async function loadSnapshot(sessionId: string, cwd = process.cwd()): Promise<SessionSnapshot | null> {
  const filePath = path.join(getSessionDirectory(sessionId, cwd), "session-snapshot.json")
  try {
    const data = await fs.readFile(filePath, "utf-8")
    const snapshot = JSON.parse(data) as SessionSnapshot
    return snapshot
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    log.error("failed to load snapshot", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export function getSnapshotPath(sessionId: string, cwd = process.cwd()): string {
  return path.join(getSessionDirectory(sessionId, cwd), "session-snapshot.json")
}
