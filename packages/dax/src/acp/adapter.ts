import { RAOProtocol } from "@/rao/schema"
import type { ACPSessionState } from "./types"

export namespace ACPAdapter {
  export interface ACPMessage {
    jsonrpc: "2.0"
    method: string
    params: Record<string, unknown>
    id?: string | number
  }

  export function broadcastRunState(state: RAOProtocol.RunState): ACPMessage {
    return {
      jsonrpc: "2.0",
      method: "workspace/runStateChanged",
      params: {
        runId: state.runId,
        status: state.status,
        currentStep: state.currentStep,
        evidenceCount: state.evidence.length,
      },
    }
  }

  export function broadcastApprovalRequest(request: RAOProtocol.ApprovalRequest): ACPMessage {
    return {
      jsonrpc: "2.0",
      method: "workspace/approvalRequested",
      params: {
        approvalId: request.approvalId,
        runId: request.runId,
        reason: request.reason,
        proposedAction: request.proposedAction,
        risk: request.risk,
      },
      id: request.approvalId, // Expecting a response with this ID
    }
  }

  export function buildSessionConfig(runId: string, allowedTools: string[]): ACPSessionState {
    return {
      id: runId,
      cwd: process.cwd(),
      mcpServers: [], // Populated by FastMCP substrate
      createdAt: new Date(),
    }
  }
}
