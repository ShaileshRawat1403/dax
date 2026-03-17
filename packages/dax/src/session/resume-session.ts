import { loadSnapshot } from "./persist-state"
import type { SessionState } from "./state-types"
import type { GraphStatus } from "./snapshot-types"

export interface ResumeContext {
  sessionId: string
  restoredState: SessionState
  graphStatus: GraphStatus | undefined
}

export async function resumeSession(sessionId: string): Promise<ResumeContext | null> {
  const snapshot = loadSnapshot(sessionId)

  if (!snapshot) {
    return null
  }


  return {
    sessionId,
    restoredState: snapshot.state,
    graphStatus: snapshot.graphStatus,
  }
}
