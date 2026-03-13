import * as fs from "fs"
import * as path from "path"
import type { SessionSnapshot, GraphStatus } from "./snapshot-types"
import type { SessionState } from "./state-types"

const SESSION_DIR = ".dax/sessions"

export function saveSnapshot(
  sessionId: string,
  state: SessionState,
  graphStatus?: GraphStatus,
  workflowId?: string,
): void {
  const snapshot: SessionSnapshot = {
    sessionId,
    workflowId,
    savedAt: new Date().toISOString(),
    state,
    graphStatus,
  }

  const dirPath = path.join(process.cwd(), SESSION_DIR, sessionId)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }

  const filePath = path.join(dirPath, "session-snapshot.json")
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2))
  console.log(`Session snapshot saved to ${filePath}`)
}

export function loadSnapshot(sessionId: string): SessionSnapshot | null {
  const filePath = path.join(process.cwd(), SESSION_DIR, sessionId, "session-snapshot.json")

  if (!fs.existsSync(filePath)) {
    console.log(`No snapshot found for session ${sessionId}`)
    return null
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8")
    const snapshot = JSON.parse(data) as SessionSnapshot
    console.log(`Session snapshot loaded from ${filePath}`)
    return snapshot
  } catch (error) {
    console.error(`Failed to load snapshot for session ${sessionId}:`, error)
    return null
  }
}

export function getSnapshotPath(sessionId: string): string {
  return path.join(process.cwd(), SESSION_DIR, sessionId, "session-snapshot.json")
}
