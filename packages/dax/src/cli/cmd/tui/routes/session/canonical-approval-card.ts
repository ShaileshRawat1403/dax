import type { RunInspectorProjectionV1 } from "@/server/run-inspector-projection"
import type { CanonicalInspectorState } from "./canonical-inspector-state"

export type CanonicalApprovalCard = {
  approvalId: string
  title: string
  type: string
  risk: string
  reason: string
  expectedConsequence: string
  requestedAt: string
  correlation: string
  actionContext: string
  scope: string
  status: string
  decidedBy?: string
  decidedAt?: string
}

export function selectCanonicalApproval(snapshot: RunInspectorProjectionV1, selectedApprovalId?: string) {
  return (
    (selectedApprovalId ? snapshot.approvals.find((approval) => approval.approvalId === selectedApprovalId) : undefined) ??
    snapshot.approvals.find((approval) => approval.status === "pending") ??
    snapshot.approvals[0]
  )
}

export function pendingCanonicalApprovalCount(snapshot: RunInspectorProjectionV1) {
  return snapshot.approvals.filter((approval) => approval.status === "pending").length
}

export function selectAdjacentCanonicalApproval(
  snapshot: RunInspectorProjectionV1,
  selectedApprovalId: string | undefined,
  direction: -1 | 1,
) {
  if (snapshot.approvals.length === 0) return undefined
  const current = snapshot.approvals.findIndex((approval) => approval.approvalId === selectedApprovalId)
  const index = current < 0 ? 0 : (current + direction + snapshot.approvals.length) % snapshot.approvals.length
  return snapshot.approvals[index]
}

export function presentCanonicalApproval(snapshot: RunInspectorProjectionV1, approvalId?: string): CanonicalApprovalCard | undefined {
  const approval = selectCanonicalApproval(snapshot, approvalId)
  if (!approval) return undefined
  const invocation = approval.correlationId
    ? snapshot.durableAuthorization.items.find((item) => item.invocationId === approval.correlationId)
    : undefined
  const scope = snapshot.contract.limits.scope.targetFiles.values
  const context = approval.context
  const actionContext = [
    context?.command ? `Command: ${context.command}` : undefined,
    context?.filePath ? `Path: ${context.filePath}` : undefined,
    context?.toolName ? `Tool: ${context.toolName}` : invocation ? `Tool: ${invocation.toolId}` : undefined,
    context?.diffPreview ? `Diff: ${context.diffPreview}` : undefined,
  ].filter((line): line is string => Boolean(line))

  return {
    approvalId: approval.approvalId,
    title: approval.title ?? `${approval.type} approval`,
    type: approval.type,
    risk: approval.risk,
    reason: approval.reason ?? "Reason not recorded.",
    expectedConsequence: approval.expectedConsequence ?? "Expected consequence not recorded.",
    requestedAt: approval.requestedAt,
    correlation: invocation
      ? `Invocation ${invocation.invocationId} · ${invocation.toolId}`
      : approval.correlationId
        ? `Invocation ${approval.correlationId}`
        : "No invocation correlation recorded.",
    actionContext: actionContext.length ? actionContext.join(" · ") : "Exact target not recorded.",
    scope: scope.length ? `Relevant scope: ${scope.join(", ")}` : "Relevant contract scope not recorded.",
    status: approval.status,
    ...(approval.decidedBy ? { decidedBy: approval.decidedBy } : {}),
    ...(approval.decidedAt ? { decidedAt: approval.decidedAt } : {}),
  }
}

export function canResolveCanonicalApproval(input: {
  state: CanonicalInspectorState
  runId: string
  approvalId?: string
  inFlight: boolean
}) {
  if (input.inFlight || !input.approvalId || input.state.status !== "ready") return false
  if (input.state.snapshot.kind !== "canonical" || input.state.snapshot.runId !== input.runId) return false
  return input.state.snapshot.approvals.some(
    (approval) => approval.approvalId === input.approvalId && approval.status === "pending",
  )
}

/**
 * Decides whether a raw keypress is an intentional canonical approval decision.
 *
 * `useKeyboard` in OpenTUI is a process-wide handler, not a focus-scoped one, so
 * the approval pane received every keystroke the terminal produced — including
 * ordinary typing in the prompt textarea and in open dialogs. With a pending
 * approval selected, typing a word containing "y" resolved it. The stream-level
 * handler in `routes/session/index.tsx` already guards on prompt focus; this is
 * the same rule, expressed as data so it can be tested without a renderer.
 *
 * A decision requires all of: the approval is genuinely actionable, no other
 * surface owns text input, and the key carries no modifier.
 */
export function canonicalApprovalKeyDecision(input: {
  actionable: boolean
  /** True when the prompt textarea currently owns keyboard input. */
  promptFocused: boolean
  /** Depth of the modal dialog stack; any open dialog owns input. */
  dialogDepth: number
  event: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
}): "approve" | "deny" | undefined {
  if (!input.actionable) return undefined
  if (input.promptFocused) return undefined
  if (input.dialogDepth > 0) return undefined
  if (input.event.ctrl || input.event.meta || input.event.shift) return undefined
  if (input.event.name === "y") return "approve"
  if (input.event.name === "n") return "deny"
  return undefined
}

export type CanonicalApprovalTransport = {
  resolve: (approvalId: string, decision: "approve" | "deny") => Promise<void>
  read: () => Promise<unknown>
}

export function canonicalApprovalHeading(status: string) {
  return status === "pending" ? "DECISION REQUIRED" : "APPROVAL RECORDED"
}

export function canonicalApprovalResolutionRequest(
  runId: string,
  approvalId: string,
  decision: "approve" | "deny",
) {
  return {
    path: `/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, actorId: "tui-operator", source: "dax" }),
    } satisfies RequestInit,
  }
}

export async function resolveThenReadCanonicalApproval(
  transport: CanonicalApprovalTransport,
  approvalId: string,
  decision: "approve" | "deny",
) {
  await transport.resolve(approvalId, decision)
  return transport.read()
}
