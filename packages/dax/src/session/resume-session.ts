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
    console.log(`No snapshot found for session ${sessionId}. Cannot resume.`)
    return null
  }

  console.log(`Resuming session ${sessionId}`)
  console.log(`Workflow: ${snapshot.workflowId}`)
  console.log(`Completed nodes: ${snapshot.graphStatus?.completedNodeIds?.length || 0}`)
  console.log(`Pending nodes: ${snapshot.graphStatus?.pendingNodeIds?.length || 0}`)

  return {
    sessionId,
    restoredState: snapshot.state,
    graphStatus: snapshot.graphStatus,
  }
}
