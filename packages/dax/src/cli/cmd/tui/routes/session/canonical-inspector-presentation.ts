import type { RunInspectorProjectionV1, RunInspectorReadResultV1 } from "@/server/run-inspector-projection"
import type { DisplayMode } from "@/dax/presentation/session-display"

export type InspectorSection = { title: string; lines: string[]; warning?: boolean }

const statusLabel = (status: string) => status.replaceAll("_", " ")

function bounded(label: string, values: string[], omitted: number) {
  const rendered = values.length ? values.join(", ") : "none"
  return `${label}: ${rendered}${omitted > 0 ? ` (+${omitted} omitted)` : ""}`
}

function invocationLine(invocation: RunInspectorProjectionV1["durableAuthorization"]["items"][number]) {
  if (!invocation.authorization) return `${invocation.toolId}: awaiting authorization`
  if (invocation.authorization.finalDisposition === "denied") return `${invocation.toolId}: denied — not executed`
  if (!invocation.result) return `${invocation.toolId}: authorized; terminal result unknown`
  return `${invocation.toolId}: ${statusLabel(invocation.result.status)} (not completion proof)`
}

function authorizationState(snapshot: RunInspectorProjectionV1) {
  const invocations = snapshot.durableAuthorization.items
  if (!invocations.length) return "not recorded"
  if (invocations.some((item) => !item.authorization)) return "pending"
  if (invocations.some((item) => item.authorization?.finalDisposition === "denied")) return "denied"
  return "allowed"
}

function executionResultState(snapshot: RunInspectorProjectionV1) {
  const results = snapshot.durableAuthorization.items.flatMap((item) => (item.result ? [item.result.status] : []))
  if (!results.length) return "not recorded"
  return results.map(statusLabel).join(", ")
}

function completionState(snapshot: RunInspectorProjectionV1) {
  if (snapshot.completion.genericCompletionProof) return `proof ${statusLabel(snapshot.completion.genericCompletionProof.decision)}`
  return "not proven"
}

function canonicalSections(snapshot: RunInspectorProjectionV1, mode: DisplayMode): InspectorSection[] {
  const technical = mode === "inspect"
  const sections: InspectorSection[] = [
    {
      title: "CANONICAL AUTHORITY · READ ONLY",
      lines: [
        "Canonical event-log authority",
        `Run: ${snapshot.runId}`,
        `Contract: ${snapshot.contract.contractId}`,
        `Status: ${statusLabel(snapshot.canonicalStatus)}`,
        `Validated sequence: ${snapshot.authority.eventSequence}`,
        ...(technical ? [`Cursor: ${snapshot.authority.cursor}`] : []),
      ],
    },
    {
      title: "INTENT AND LIMITS",
      lines: [
        snapshot.invocationIntent.intent,
        `Workflow: ${snapshot.contract.workflowClass} · ${snapshot.contract.executionMode} · ${snapshot.contract.riskLevel} risk`,
        bounded("Expected outputs", snapshot.invocationIntent.expectedOutputs.map((item) => item.type), snapshot.invocationIntent.expectedOutputsOmittedCount),
        bounded("Allowed tools", snapshot.contract.toolAllowlist, snapshot.contract.toolAllowlistOmittedCount),
        bounded("Blocked tools", snapshot.contract.toolBlocklist, snapshot.contract.toolBlocklistOmittedCount),
        `Verification: ${snapshot.contract.limits.postconditions.verificationRequired ? "required" : "not required"} · timeout ${snapshot.contract.timeoutMs}ms`,
        ...(technical
          ? [
              bounded("Scope", snapshot.contract.limits.scope.targetFiles.values, snapshot.contract.limits.scope.targetFiles.omittedCount),
              bounded("Forbidden", snapshot.contract.limits.sensitivity.forbiddenPatterns.values, snapshot.contract.limits.sensitivity.forbiddenPatterns.omittedCount),
              bounded("Egress allowlist", snapshot.contract.limits.egress.allowHosts.values, snapshot.contract.limits.egress.allowHosts.omittedCount),
            ]
          : []),
      ],
    },
    {
      title: "CURRENT EXECUTION TRUTH",
      lines: snapshot.durableAuthorization.items.length
        ? snapshot.durableAuthorization.items.map(invocationLine)
        : ["No canonical tool invocation records."],
    },
    {
      title: "APPROVAL HISTORY",
      lines: snapshot.approvals.length
        ? snapshot.approvals.map((approval) => `${approval.type}: ${statusLabel(approval.status)}${approval.decidedBy ? ` by ${approval.decidedBy}` : ""}`)
        : ["No canonical approval records."],
    },
    {
      title: "EVIDENCE CHAIN",
      lines: [
        "Intent: recorded",
        `Authorization: ${authorizationState(snapshot)}`,
        `Execution result: ${executionResultState(snapshot)}`,
        `Mutation evidence: ${snapshot.mutationEvidence.receiptCount ? `${snapshot.mutationEvidence.receiptCount} receipt(s), ${snapshot.mutationEvidence.changedPathCount} path(s)` : "not observed"}`,
        `Verification: ${snapshot.verificationEvidence.satisfied ? "satisfied" : snapshot.verificationEvidence.required ? "required · absent" : "not required"}`,
        `Completion: ${completionState(snapshot)}`,
        `Artifacts: ${snapshot.artifactEvidence.items.length}${snapshot.artifactEvidence.omittedCount ? ` (+${snapshot.artifactEvidence.omittedCount} omitted)` : ""}`,
        ...(snapshot.workerEvidence.sandbox
          ? [`Worker sandbox: ${snapshot.workerEvidence.sandbox.provider}; detailed worker actions unavailable.`]
          : []),
        ...(technical && snapshot.completion.genericCompletionProof ? [`Completion decision: ${snapshot.completion.genericCompletionProof.decision}`] : []),
      ],
    },
    {
      title: "UNCERTAINTY",
      warning: snapshot.uncertainty.length > 0 || Boolean(snapshot.completion.integrityWarning),
      lines: [
        ...snapshot.uncertainty.map((entry) => entry.detail ?? statusLabel(entry.code)),
        ...(snapshot.completion.integrityWarning ? [statusLabel(snapshot.completion.integrityWarning)] : []),
        ...(snapshot.uncertainty.length === 0 && !snapshot.completion.integrityWarning ? ["No projected uncertainty."] : []),
      ],
    },
    {
      title: "CHRONOLOGY",
      lines: snapshot.chronology.items.map((item) => `${item.sequence}: ${statusLabel(item.eventType)}`),
      warning: snapshot.chronology.omittedCount > 0,
    },
  ]
  if (snapshot.chronology.omittedCount > 0) sections.at(-1)!.lines.push(`+${snapshot.chronology.omittedCount} chronology items omitted`)
  return sections
}

export function presentCanonicalInspector(result: RunInspectorReadResultV1, mode: DisplayMode): InspectorSection[] {
  if (result.kind === "authority_unreadable") {
    return [{ title: "CANONICAL AUTHORITY UNREADABLE", warning: true, lines: [`Reason: ${statusLabel(result.reason)}`, "No fallback state is shown."] }]
  }
  if (result.kind === "legacy_unsupported") {
    return [{ title: "CANONICAL INSPECTOR UNSUPPORTED", warning: true, lines: [`Reason: ${statusLabel(result.reason)}`, "This session does not have supported canonical authority."] }]
  }
  return canonicalSections(result, mode)
}
