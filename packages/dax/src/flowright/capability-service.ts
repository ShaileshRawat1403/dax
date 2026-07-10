import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { RunGateway } from "@/server/run-gateway"
import type { CreateRunRequest } from "@/server/run-contract"
import { Identifier } from "@/id/id"
import { buildCapabilityReceipt } from "./capability-adapter"
import type {
  CapabilityApprovalDecisionRequest,
  CapabilityInvokeRequest,
  CapabilityInvokeResponse,
  CapabilityRunReceipt,
} from "./capability-contract"

type CapabilityName = "dax.repo_analyze" | "dax.draft_and_approve" | "dax.review_and_signoff"
type CapabilityWorkflowHint = NonNullable<CreateRunRequest["workflowHint"]>

type InvocationRecord = {
  invocationId: string
  capability: CapabilityName
  externalRunId: string
  createdAt: string
  flowright?: CapabilityInvokeRequest["flowright"]
}

const CAPABILITY_WORKFLOWS: Record<CapabilityName, CapabilityWorkflowHint> = {
  "dax.repo_analyze": "repo_analyze",
  "dax.draft_and_approve": "draft_and_approve",
  "dax.review_and_signoff": "review_and_signoff",
}

function assertCapability(capability: string): asserts capability is CapabilityName {
  if (!(capability in CAPABILITY_WORKFLOWS)) {
    throw new Error(`Unsupported Flowright capability: ${capability}`)
  }
}

function invocationPath(invocationId: string) {
  return ["flowright_capability_invocations", Instance.project.id, invocationId]
}

async function writeInvocation(record: InvocationRecord) {
  await Storage.write(invocationPath(record.invocationId), record)
}

async function readInvocation(invocationId: string): Promise<InvocationRecord> {
  return Storage.read<InvocationRecord>(invocationPath(invocationId))
}

async function waitForReceiptReady(runId: string, timeoutMs: number): Promise<{ timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const snapshot = await RunGateway.getSnapshot(runId)
    if (
      snapshot.status === "completed" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled" ||
      snapshot.status === "waiting_approval" ||
      snapshot.pendingApprovalCount > 0
    ) {
      return { timedOut: false }
    }
    await Bun.sleep(50)
  }
  return { timedOut: true }
}

async function buildReceipt(record: InvocationRecord, options?: { timeoutReason?: string }): Promise<CapabilityRunReceipt> {
  const [snapshot, approvals, artifacts, events] = await Promise.all([
    RunGateway.getSnapshot(record.externalRunId),
    RunGateway.getApprovals(record.externalRunId),
    RunGateway.listArtifacts(record.externalRunId),
    RunGateway.replayEvents(record.externalRunId),
  ])

  return buildCapabilityReceipt({
    capability: record.capability,
    invocationId: record.invocationId,
    snapshot,
    approvals,
    artifacts,
    events,
    deepLink: `/runs/${record.externalRunId}`,
    timeoutReason: options?.timeoutReason,
  })
}

function buildCreateRunRequest(capability: CapabilityName, input: CapabilityInvokeRequest): CreateRunRequest {
  const workflowHint = CAPABILITY_WORKFLOWS[capability]
  const prompt = input.input.prompt?.trim() || `Run ${capability}`
  return {
    intent: {
      input: prompt,
      kind: workflowHint === "repo_analyze" ? "analysis" : "workflow_step",
      repoPath: input.input.repoPath,
      metadata: input.input.metadata,
    },
    workflowHint,
    metadata: {
      source: "api",
      initiatedBy: "flowright",
      workflowId: input.flowright?.runId,
      targeting: input.input.repoPath
        ? {
            mode: "explicit_repo_path",
            repoPath: input.input.repoPath,
          }
        : undefined,
    },
  }
}

export namespace FlowrightCapabilityService {
  export async function invoke(capability: string, input: CapabilityInvokeRequest): Promise<CapabilityInvokeResponse> {
    assertCapability(capability)
    const invocationId = input.invocationId ?? `cap_${Identifier.create("session", false)}`
    const create = await RunGateway.createRun(buildCreateRunRequest(capability, input))
    const record: InvocationRecord = {
      invocationId,
      capability,
      externalRunId: create.runId,
      createdAt: new Date().toISOString(),
      flowright: input.flowright,
    }
    await writeInvocation(record)

    const timeoutMs = input.timeoutMs ?? 5000
    const readiness = await waitForReceiptReady(create.runId, timeoutMs)
    const receipt = await buildReceipt(
      record,
      readiness.timedOut ? { timeoutReason: `DAX run did not reach a terminal or approval state within ${timeoutMs}ms.` } : undefined,
    )
    return {
      invocationId,
      externalRunId: create.runId,
      receipt,
    }
  }

  export async function getReceipt(invocationId: string): Promise<CapabilityRunReceipt> {
    return buildReceipt(await readInvocation(invocationId))
  }

  export async function decideApproval(
    invocationId: string,
    gateId: string,
    input: CapabilityApprovalDecisionRequest,
  ): Promise<CapabilityRunReceipt> {
    const record = await readInvocation(invocationId)
    await RunGateway.resolveApproval(record.externalRunId, gateId, {
      decision: input.decision,
      actorId: input.actorId,
      source: "api",
      comment: input.comment,
    })
    return buildReceipt(record)
  }
}
