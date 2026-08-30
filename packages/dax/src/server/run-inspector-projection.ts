import { z } from "zod"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { CanonicalRunState } from "@/state/events/run-reducer"
import { RUN_EVENT_TYPES, type RunEventEnvelope, type RunEventPayload } from "@/state/events/run-event-types"

const MAX_TEXT_LENGTH = 512
const MAX_COLLECTION_ITEMS = 100
const MAX_CHRONOLOGY_ITEMS = 200

type CanonicalEvent<Type extends RunEventPayload["type"]> = Omit<RunEventEnvelope, "type" | "payload"> &
  Extract<RunEventPayload, { type: Type }>

function boundedText(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH - 1)}…`
}

function bounded<T>(items: T[], limit = MAX_COLLECTION_ITEMS) {
  return {
    items: items.slice(0, limit),
    omittedCount: Math.max(0, items.length - limit),
  }
}

const InspectorSchemaVersion = z.literal("run-inspector.v1")
const BoundedStringList = z
  .object({ values: z.string().array(), omittedCount: z.number().int().nonnegative() })
  .strict()
const UncertaintyEntry = z
  .object({
    code: z.enum([
      "pending_approvals",
      "unresolved_invocations",
      "verification_required_but_unsatisfied",
      "completed_without_generic_completion_proof",
      "completed_with_failing_generic_completion_proof",
      "chronology_truncated",
      "invocation_details_truncated",
      "artifact_details_truncated",
      "contract_details_truncated",
      "worker_action_details_unavailable",
    ]),
    subjectIds: z.string().array().optional(),
    subjectIdsOmittedCount: z.number().int().nonnegative().optional(),
    detail: z.string().optional(),
  })
  .strict()

const AuthorityUnreadable = z
  .object({
    schemaVersion: InspectorSchemaVersion,
    kind: z.literal("authority_unreadable"),
    runId: z.string(),
    reason: z.enum([
      "authority_marker_unreadable",
      "authority_marker_missing",
      "canonical_log_unreadable",
      "canonical_log_empty",
      "canonical_state_unreadable",
      "execution_contract_unreadable",
      "execution_contract_missing",
      "execution_contract_mismatch",
    ]),
  })
  .strict()

const LegacyUnsupported = z
  .object({
    schemaVersion: InspectorSchemaVersion,
    kind: z.literal("legacy_unsupported"),
    runId: z.string(),
    reason: z.enum(["legacy_authority", "no_canonical_authority"]),
  })
  .strict()

const ChronologyItem = z
  .object({
    sequence: z.number().int().nonnegative(),
    eventId: z.string(),
    occurredAt: z.string(),
    category: z.enum(["contract", "lifecycle", "authorization", "approval", "execution", "evidence", "completion"]),
    eventType: z.enum(RUN_EVENT_TYPES),
    subjectId: z.string().optional(),
    disposition: z.string().optional(),
  })
  .strict()

export const RunInspectorProjectionV1 = z
  .object({
    schemaVersion: InspectorSchemaVersion,
    kind: z.literal("canonical"),
    runId: z.string(),
    authority: z
      .object({
        source: z.literal("event-log"),
        validated: z.literal(true),
        eventSequence: z.number().int().nonnegative(),
        cursor: z.string(),
      })
      .strict(),
    canonicalStatus: z.enum([
      "created",
      "compiled",
      "queued",
      "running",
      "waiting_approval",
      "completed",
      "failed",
      "cancelled",
    ]),
    contract: z
      .object({
        contractId: z.string(),
        contractInstanceId: z.string().optional(),
        contractDigest: z.string().optional(),
        workflowClass: z.string(),
        executionMode: z.string(),
        riskLevel: z.string(),
        createdAt: z.string(),
        timeoutMs: z.number(),
        toolAllowlist: z.string().array(),
        toolAllowlistOmittedCount: z.number().int().nonnegative(),
        toolBlocklist: z.string().array(),
        toolBlocklistOmittedCount: z.number().int().nonnegative(),
        approvalPolicy: z
          .object({
            mode: z.string(),
            requireForRiskAbove: z.string().optional(),
            toolCategories: z.string().array().optional(),
          })
          .strict(),
        limits: z
          .object({
            maxFilesTouched: z.number().optional(),
            maxMutatingCommands: z.number().optional(),
            maxApprovalRequests: z.number().optional(),
            maxRepeatedFailures: z.number().optional(),
            scope: z
              .object({
                targetFiles: BoundedStringList,
                targetSubsystems: BoundedStringList,
                avoidAreas: BoundedStringList,
              })
              .strict(),
            sensitivity: z
              .object({ sensitivePatterns: BoundedStringList, forbiddenPatterns: BoundedStringList })
              .strict(),
            postconditions: z
              .object({
                verificationRequired: z.boolean(),
                validationPlan: BoundedStringList,
                validationCommands: BoundedStringList,
              })
              .strict(),
            egress: z.object({ filter: z.boolean(), allowHosts: BoundedStringList }).strict(),
          })
          .strict(),
      })
      .strict(),
    invocationIntent: z
      .object({
        intent: z.string(),
        repoPath: z.string().optional(),
        branch: z.string().optional(),
        initiatedBy: z.string().optional(),
        expectedOutputs: z.array(
          z.object({ type: z.string(), description: z.string(), pathHint: z.string().optional() }).strict(),
        ),
        expectedOutputsOmittedCount: z.number().int().nonnegative(),
      })
      .strict(),
    durableAuthorization: z
      .object({
        items: z.array(
          z
            .object({
              invocationId: z.string(),
              toolId: z.string(),
              executor: z.object({ kind: z.string(), id: z.string() }).strict(),
              status: z.string(),
              workflowStepId: z.string().optional(),
              inputCommitment: z
                .object({ digest: z.string(), redactedPreview: z.string(), truncated: z.boolean() })
                .strict()
                .optional(),
              authorization: z
                .object({
                  finalDisposition: z.string(),
                  contractDisposition: z.string(),
                  runtimeGuardDisposition: z.string(),
                  permissionDisposition: z.string(),
                  approvalIds: z.string().array(),
                  reasonCodes: z.string().array(),
                })
                .strict()
                .optional(),
              result: z
                .object({
                  status: z.string(),
                  commitment: z
                    .object({ digest: z.string(), redactedPreview: z.string(), truncated: z.boolean() })
                    .strict()
                    .optional(),
                  failureCode: z.string().optional(),
                  cancellationCode: z.string().optional(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        ),
        omittedCount: z.number().int().nonnegative(),
      })
      .strict(),
    approvals: z.array(
      z
        .object({
          approvalId: z.string(),
          type: z.string(),
          risk: z.string(),
          status: z.string(),
          title: z.string().optional(),
          reason: z.string().optional(),
          expectedConsequence: z.string().optional(),
          stepId: z.string().optional(),
          source: z.enum(["workflow", "permission", "system", "manual"]).nullable(),
          context: z
            .object({
              stepId: z.string().optional(),
              filePath: z.string().optional(),
              command: z.string().optional(),
              toolName: z.string().optional(),
              diffPreview: z.string().optional(),
              notes: z.string().array().optional(),
              notesOmittedCount: z.number().int().nonnegative().optional(),
              originalPermissionId: z.string().optional(),
            })
            .strict()
            .nullable(),
          requestedAt: z.string(),
          decidedAt: z.string().optional(),
          decidedBy: z.string().optional(),
          comment: z.string().optional(),
          correlationId: z.string().optional(),
        })
        .strict(),
    ),
    outcome: z
      .object({
        terminal: z
          .object({
            eventType: z.string(),
            occurredAt: z.string(),
            result: z.enum(["completed", "failed", "cancelled"]),
          })
          .strict()
          .nullable(),
        unresolved: z
          .object({
            canonicalStatus: z.string(),
            currentStepId: z.string().nullable(),
            pendingApprovalIds: z.string().array(),
          })
          .strict()
          .nullable(),
        error: z.object({ code: z.string(), retryable: z.boolean() }).strict().nullable(),
      })
      .strict(),
    mutationEvidence: z
      .object({
        receiptIds: z.string().array(),
        changedPaths: z.string().array(),
        receiptCount: z.number(),
        changedPathCount: z.number(),
        items: z.array(
          z.discriminatedUnion("kind", [
            z
              .object({
                kind: z.literal("attested"),
                receiptId: z.string(),
                changedPaths: z.string().array(),
                changedPathsOmittedCount: z.number().int().nonnegative(),
                digest: z.string(),
                claim: z.string(),
                recordedAt: z.string(),
                observationWindowInvocationIds: z.string().array(),
                observationWindowInvocationIdsOmittedCount: z.number().int().nonnegative(),
              })
              .strict(),
            z
              .object({
                kind: z.literal("references_only"),
                receiptIds: z.string().array(),
                receiptIdsOmittedCount: z.number().int().nonnegative(),
                changedPaths: z.string().array(),
                changedPathsOmittedCount: z.number().int().nonnegative(),
              })
              .strict(),
          ]),
        ),
        omittedCount: z.number().int().nonnegative(),
      })
      .strict(),
    verificationEvidence: z
      .object({
        required: z.boolean(),
        satisfied: z.boolean(),
        receiptIds: z.string().array(),
        checks: z.array(
          z
            .object({
              id: z.string(),
              kind: z.string(),
              label: z.string(),
              command: z.string(),
              cwd: z.string(),
              status: z.string(),
              required: z.boolean(),
              exitCode: z.number().nullable(),
              durationMs: z.number(),
              stdoutPreview: z.string(),
              stderrPreview: z.string(),
            })
            .strict(),
        ),
        checksOmittedCount: z.number().int().nonnegative(),
        receipts: z.array(
          z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("receipt_id_only"), receiptId: z.string() }).strict(),
            z
              .object({
                kind: z.literal("attested"),
                schemaVersion: z.literal("dax.sdlc.receipt.v1"),
                receiptId: z.string(),
                runId: z.string(),
                claim: z.string(),
                proofType: z.literal("command_result"),
                source: z.literal("dax"),
                checkId: z.string(),
                status: z.string(),
                command: z.string(),
                cwd: z.string(),
                durationMs: z.number(),
                verifiedAt: z.string(),
                digest: z.string(),
              })
              .strict(),
          ]),
        ),
        receiptsOmittedCount: z.number().int().nonnegative(),
      })
      .strict(),
    artifactEvidence: z
      .object({
        items: z.array(z.object({ artifactId: z.string(), type: z.string(), createdAt: z.string() }).strict()),
        omittedCount: z.number(),
      })
      .strict(),
    workerEvidence: z
      .object({
        refinedContract: z
          .object({
            writeScope: z.string().array(),
            forbiddenPaths: z.string().array(),
            verification: z.string().array(),
            provenance: z.record(z.string(), z.string()).nullable(),
          })
          .strict()
          .nullable(),
        sandbox: z
          .object({
            provider: z.string(),
            providerId: z.string().nullable(),
            filesystem: z.string(),
            network: z.string(),
            reapedDescendants: z.boolean(),
            egress: z.string().nullable(),
            egressEnforcement: z.string().nullable(),
            egressAllowHosts: BoundedStringList,
          })
          .strict()
          .nullable(),
        egressDenialCount: z.number(),
        egressDenials: z.array(
          z
            .object({ providerId: z.string().nullable(), hosts: z.string().array(), hostsOmittedCount: z.number() })
            .strict(),
        ),
        egressDenialsOmittedCount: z.number().int().nonnegative(),
      })
      .strict(),
    completion: z
      .object({
        terminalEvent: z.object({ eventType: z.string(), occurredAt: z.string() }).strict().nullable(),
        genericCompletionProof: z
          .object({
            decision: z.string(),
            failedChecks: z.string().array(),
            verificationExecuted: z.boolean(),
            receiptIds: z.string().array(),
            artifactChecks: z.boolean(),
            expectedOutputChecks: z.boolean(),
            expectedOutputTypesSatisfied: z.string().array(),
            expectedOutputTypesMissing: z.string().array(),
            scopeChecks: z.boolean(),
            sensitivePathApprovalChecks: z.boolean(),
            checkedAt: z.string(),
          })
          .strict()
          .nullable(),
        workflowSpecificEvidence: z.object({ eventType: z.string(), occurredAt: z.string() }).strict().nullable(),
        integrityWarning: z
          .enum(["completed_without_generic_completion_proof", "completed_with_failing_generic_completion_proof"])
          .nullable(),
      })
      .strict(),
    uncertainty: UncertaintyEntry.array(),
    chronology: z.object({ items: ChronologyItem.array(), omittedCount: z.number().int().nonnegative() }).strict(),
  })
  .strict()

export const RunInspectorReadResultV1 = z.discriminatedUnion("kind", [
  RunInspectorProjectionV1,
  AuthorityUnreadable,
  LegacyUnsupported,
])
export type RunInspectorProjectionV1 = z.infer<typeof RunInspectorProjectionV1>
export type RunInspectorReadResultV1 = z.infer<typeof RunInspectorReadResultV1>

function terminalEvent(events: RunEventEnvelope[]) {
  return [...events]
    .reverse()
    .find((event) =>
      [
        "run_completed",
        "workflow_completed",
        "workflow_signed_off",
        "workflow_rejected",
        "workflow_expired",
        "run_failed",
        "workflow_failed",
        "approval_denied",
      ].includes(event.type),
    )
}

function terminalResult(event: RunEventEnvelope | undefined): "completed" | "failed" | "cancelled" | undefined {
  if (!event) return undefined
  if (["run_completed", "workflow_completed", "workflow_signed_off"].includes(event.type)) return "completed"
  if (["workflow_rejected", "workflow_expired"].includes(event.type)) return "cancelled"
  return "failed"
}

function completionProofFromTerminal(event: RunEventEnvelope | undefined) {
  if (
    !event ||
    !["run_completed", "workflow_completed", "workflow_signed_off", "workflow_rejected", "workflow_expired"].includes(
      event.type,
    )
  ) {
    return undefined
  }
  return (event.payload as { completionProof?: CanonicalRunState["governance"]["completionProof"] }).completionProof
}

function chronologyItem(event: RunEventEnvelope): z.infer<typeof ChronologyItem> {
  const payload = event.payload as Record<string, unknown>
  const base = { sequence: event.seq, eventId: event.eventId, occurredAt: event.occurredAt, eventType: event.type }
  switch (event.type) {
    case "contract_compiled":
      return { ...base, category: "contract", subjectId: String(payload.contractId) }
    case "tool_invocation_recorded":
      return { ...base, category: "execution", subjectId: String(payload.invocationId) }
    case "authorization_recorded":
      return {
        ...base,
        category: "authorization",
        subjectId: String(payload.invocationId),
        disposition: String(payload.finalDisposition),
      }
    case "tool_result_recorded":
      return {
        ...base,
        category: "execution",
        subjectId: String(payload.invocationId),
        disposition: String(payload.status),
      }
    case "approval_requested":
    case "approval_resolved":
      return {
        ...base,
        category: "approval",
        subjectId: String(payload.approvalId),
        disposition: typeof payload.decision === "string" ? payload.decision : undefined,
      }
    case "artifact_created":
      return { ...base, category: "evidence", subjectId: String(payload.artifactId) }
    case "run_completed":
    case "workflow_completed":
    case "workflow_signed_off":
    case "workflow_rejected":
    case "workflow_expired":
    case "run_failed":
    case "workflow_failed":
    case "approval_denied":
      return { ...base, category: "completion" }
    case "mutation_recorded":
    case "verification_recorded":
    case "contract_refined":
    case "worker_sandbox_recorded":
    case "worker_egress_denied":
      return { ...base, category: "evidence" }
    default:
      return { ...base, category: "lifecycle" }
  }
}

/**
 * Builds the inspector from one already validated canonical snapshot. It never
 * reads session, compatibility, or mutable permission state.
 */
export function buildRunInspectorProjectionV1(input: {
  runId: string
  contract: ExecutionContract
  state: CanonicalRunState
  events: RunEventEnvelope[]
}): RunInspectorProjectionV1 {
  const { runId, contract, state, events } = input
  const invocationEventById = new Map<string, CanonicalEvent<"tool_invocation_recorded">>()
  const authorizationByInvocation = new Map<string, CanonicalEvent<"authorization_recorded">>()
  const resultByInvocation = new Map<string, CanonicalEvent<"tool_result_recorded">>()
  const verificationChecks: Array<{
    id: string
    kind: string
    label: string
    command: string
    cwd: string
    status: string
    required: boolean
    exitCode: number | null
    durationMs: number
    stdoutPreview: string
    stderrPreview: string
  }> = []
  const verificationReceipts: Array<
    | { kind: "receipt_id_only"; receiptId: string }
    | {
        kind: "attested"
        schemaVersion: "dax.sdlc.receipt.v1"
        receiptId: string
        runId: string
        claim: string
        proofType: "command_result"
        source: "dax"
        checkId: string
        status: string
        command: string
        cwd: string
        durationMs: number
        verifiedAt: string
        digest: string
      }
  > = []
  const mutationRecords: Array<
    | {
        kind: "attested"
        receiptId: string
        changedPaths: string[]
        changedPathsOmittedCount: number
        digest: string
        claim: string
        recordedAt: string
        observationWindowInvocationIds: string[]
        observationWindowInvocationIdsOmittedCount: number
      }
    | {
        kind: "references_only"
        receiptIds: string[]
        receiptIdsOmittedCount: number
        changedPaths: string[]
        changedPathsOmittedCount: number
      }
  > = []
  const artifacts: Array<{ artifactId: string; type: string; createdAt: string }> = []

  for (const event of events) {
    if (event.type === "tool_invocation_recorded") {
      const typed = event as CanonicalEvent<"tool_invocation_recorded">
      invocationEventById.set(typed.payload.invocationId, typed)
    }
    if (event.type === "authorization_recorded") {
      const typed = event as CanonicalEvent<"authorization_recorded">
      authorizationByInvocation.set(typed.payload.invocationId, typed)
    }
    if (event.type === "tool_result_recorded") {
      const typed = event as CanonicalEvent<"tool_result_recorded">
      resultByInvocation.set(typed.payload.invocationId, typed)
    }
    if (event.type === "verification_recorded") {
      const typed = event as CanonicalEvent<"verification_recorded">
      verificationChecks.push(
        ...typed.payload.checks.map((check) => ({
          id: check.id,
          kind: check.kind,
          label: boundedText(check.label) ?? "",
          command: boundedText(check.command) ?? "",
          cwd: boundedText(check.cwd) ?? "",
          status: check.status,
          required: check.required,
          exitCode: check.exitCode,
          durationMs: check.durationMs,
          stdoutPreview: boundedText(check.stdoutPreview) ?? "",
          stderrPreview: boundedText(check.stderrPreview) ?? "",
        })),
      )
      for (const receipt of typed.payload.receipts) {
        if ("schemaVersion" in receipt) {
          verificationReceipts.push({
            kind: "attested",
            schemaVersion: receipt.schemaVersion,
            receiptId: receipt.receiptId,
            runId: receipt.runId,
            claim: boundedText(receipt.claim) ?? "",
            proofType: receipt.proofType,
            source: receipt.source,
            checkId: receipt.checkId,
            status: receipt.status,
            command: boundedText(receipt.command) ?? "",
            cwd: boundedText(receipt.cwd) ?? "",
            durationMs: receipt.durationMs,
            verifiedAt: receipt.verifiedAt,
            digest: receipt.digest,
          })
        } else {
          verificationReceipts.push({ kind: "receipt_id_only", receiptId: receipt.receiptId })
        }
      }
    }
    if (event.type === "mutation_recorded") {
      const typed = event as CanonicalEvent<"mutation_recorded">
      if ("receipt" in typed.payload) {
        const changedPaths = bounded(typed.payload.receipt.changedPaths)
        const invocationIds = bounded(typed.payload.observationWindowInvocationIds)
        mutationRecords.push({
          kind: "attested",
          receiptId: typed.payload.receipt.receiptId,
          changedPaths: changedPaths.items,
          changedPathsOmittedCount: changedPaths.omittedCount,
          digest: typed.payload.receipt.digest,
          claim: boundedText(typed.payload.receipt.claim) ?? "",
          recordedAt: typed.payload.receipt.recordedAt,
          observationWindowInvocationIds: invocationIds.items,
          observationWindowInvocationIdsOmittedCount: invocationIds.omittedCount,
        })
      } else {
        const receiptIds = bounded(typed.payload.receiptIds)
        const changedPaths = bounded(typed.payload.changedPaths)
        mutationRecords.push({
          kind: "references_only",
          receiptIds: receiptIds.items,
          receiptIdsOmittedCount: receiptIds.omittedCount,
          changedPaths: changedPaths.items,
          changedPathsOmittedCount: changedPaths.omittedCount,
        })
      }
    }
    if (event.type === "artifact_created") {
      const typed = event as CanonicalEvent<"artifact_created">
      artifacts.push({
        artifactId: typed.payload.artifactId,
        type: typed.payload.artifactType,
        createdAt: event.occurredAt,
      })
    }
  }

  const invocations = Object.values(state.invocations).map((invocation) => {
    const invocationEvent = invocationEventById.get(invocation.invocationId)
    const authorizationEvent = authorizationByInvocation.get(invocation.invocationId)
    const resultEvent = resultByInvocation.get(invocation.invocationId)
    const resultPayload = resultEvent?.payload
    return {
      invocationId: invocation.invocationId,
      toolId: invocation.toolId,
      executor: invocation.executor,
      status: invocation.status,
      ...(invocation.workflowStepId ? { workflowStepId: invocation.workflowStepId } : {}),
      ...(invocationEvent
        ? {
            inputCommitment: {
              digest: invocationEvent.payload.input.digest,
              redactedPreview: boundedText(invocationEvent.payload.input.redactedPreview) ?? "",
              truncated:
                invocationEvent.payload.input.truncated ||
                invocationEvent.payload.input.redactedPreview.length > MAX_TEXT_LENGTH,
            },
          }
        : {}),
      ...(authorizationEvent
        ? {
            authorization: {
              finalDisposition: authorizationEvent.payload.finalDisposition,
              contractDisposition: authorizationEvent.payload.contractDisposition,
              runtimeGuardDisposition: authorizationEvent.payload.runtimeGuardDisposition,
              permissionDisposition: authorizationEvent.payload.permissionDisposition,
              approvalIds: authorizationEvent.payload.approvalIds.slice(0, MAX_COLLECTION_ITEMS),
              reasonCodes: authorizationEvent.payload.reasonCodes.slice(0, MAX_COLLECTION_ITEMS),
            },
          }
        : {}),
      ...(resultPayload
        ? {
            result: {
              status: resultPayload.status,
              ...(resultPayload.status === "completed"
                ? {
                    commitment: {
                      digest: resultPayload.result.digest,
                      redactedPreview: boundedText(resultPayload.result.redactedPreview) ?? "",
                      truncated:
                        resultPayload.result.truncated || resultPayload.result.redactedPreview.length > MAX_TEXT_LENGTH,
                    },
                  }
                : resultPayload.status === "failed"
                  ? { failureCode: resultPayload.failure.code }
                  : { cancellationCode: resultPayload.cancellation.code }),
            },
          }
        : {}),
    }
  })
  const boundedInvocations = bounded(invocations)
  const boundedArtifacts = bounded(artifacts)
  const boundedAllowlist = bounded(contract.toolAllowlist)
  const boundedBlocklist = bounded(contract.toolBlocklist)
  const boundedExpectedOutputs = bounded(contract.expectedOutputs)
  const boundedTargetFiles = bounded(contract.runtimePolicy?.scope.targetFiles ?? [])
  const boundedTargetSubsystems = bounded(contract.runtimePolicy?.scope.targetSubsystems ?? [])
  const boundedAvoidAreas = bounded(contract.runtimePolicy?.scope.avoidAreas ?? [])
  const boundedSensitivePatterns = bounded(contract.runtimePolicy?.sensitivity.sensitivePatterns ?? [])
  const boundedForbiddenPatterns = bounded(contract.runtimePolicy?.sensitivity.forbiddenPatterns ?? [])
  const boundedValidationPlan = bounded(contract.runtimePolicy?.postconditions.validationPlan ?? [])
  const boundedValidationCommands = bounded(contract.runtimePolicy?.postconditions.validationCommands ?? [])
  const boundedEgressAllowHosts = bounded(contract.runtimePolicy?.egress?.allowHosts ?? [])
  const boundedMutationRecords = bounded(mutationRecords)
  const boundedVerificationChecks = bounded(verificationChecks)
  const boundedVerificationReceipts = bounded(verificationReceipts)
  const boundedEgressDenials = bounded(
    state.evidence.egressDenials.map((denial) => {
      const hosts = bounded(denial.hosts)
      return { providerId: denial.providerId, hosts: hosts.items, hostsOmittedCount: hosts.omittedCount }
    }),
  )
  const boundedSandboxEgressAllowHosts = bounded(state.evidence.sandbox?.egressAllowHosts ?? [])
  const terminal = terminalEvent(events)
  const terminalOutcome = terminalResult(terminal)
  const workflowSpecificEvidence =
    terminal && terminal.type.startsWith("workflow_")
      ? { eventType: terminal.type, occurredAt: terminal.occurredAt }
      : null
  // Some workflow terminals intentionally do not use the generic completion
  // reducer transition. Their event may still carry a generic proof, so read
  // that proof from this same validated snapshot before falling back to the
  // reducer's projection.
  const canonicalCompletionProof = completionProofFromTerminal(terminal) ?? state.governance.completionProof
  const genericProof = canonicalCompletionProof
    ? {
        decision: canonicalCompletionProof.decision,
        failedChecks: canonicalCompletionProof.failedChecks.slice(0, MAX_COLLECTION_ITEMS),
        verificationExecuted: canonicalCompletionProof.verificationExecuted,
        receiptIds: canonicalCompletionProof.receiptIds.slice(0, MAX_COLLECTION_ITEMS),
        artifactChecks: canonicalCompletionProof.artifactChecks,
        expectedOutputChecks: canonicalCompletionProof.expectedOutputChecks,
        expectedOutputTypesSatisfied: canonicalCompletionProof.expectedOutputTypesSatisfied.slice(
          0,
          MAX_COLLECTION_ITEMS,
        ),
        expectedOutputTypesMissing: canonicalCompletionProof.expectedOutputTypesMissing.slice(0, MAX_COLLECTION_ITEMS),
        scopeChecks: canonicalCompletionProof.scopeChecks,
        sensitivePathApprovalChecks: canonicalCompletionProof.sensitivePathApprovalChecks,
        checkedAt: canonicalCompletionProof.checkedAt,
      }
    : null
  const integrityWarning =
    state.status !== "completed"
      ? null
      : !genericProof
        ? ("completed_without_generic_completion_proof" as const)
        : genericProof.decision === "fail"
          ? ("completed_with_failing_generic_completion_proof" as const)
          : null
  const chronological = events.slice(-MAX_CHRONOLOGY_ITEMS).map(chronologyItem)
  const uncertainty: RunInspectorProjectionV1["uncertainty"] = []
  if (state.pendingApprovalIds.length > 0) {
    uncertainty.push({
      code: "pending_approvals",
      subjectIds: state.pendingApprovalIds.slice(0, MAX_COLLECTION_ITEMS),
      ...(state.pendingApprovalIds.length > MAX_COLLECTION_ITEMS
        ? { subjectIdsOmittedCount: state.pendingApprovalIds.length - MAX_COLLECTION_ITEMS }
        : {}),
    })
  }
  const unresolvedInvocationIds = Object.values(state.invocations)
    .filter((invocation) => !["completed", "failed", "cancelled", "denied"].includes(invocation.status))
    .map((invocation) => invocation.invocationId)
  if (unresolvedInvocationIds.length > 0) {
    uncertainty.push({
      code: "unresolved_invocations",
      subjectIds: unresolvedInvocationIds.slice(0, MAX_COLLECTION_ITEMS),
      ...(unresolvedInvocationIds.length > MAX_COLLECTION_ITEMS
        ? { subjectIdsOmittedCount: unresolvedInvocationIds.length - MAX_COLLECTION_ITEMS }
        : {}),
    })
  }
  if (state.governance.verification.required && !state.governance.verification.satisfied)
    uncertainty.push({ code: "verification_required_but_unsatisfied" })
  if (integrityWarning) uncertainty.push({ code: integrityWarning })
  if (events.length > MAX_CHRONOLOGY_ITEMS) uncertainty.push({ code: "chronology_truncated" })
  if (boundedInvocations.omittedCount > 0) uncertainty.push({ code: "invocation_details_truncated" })
  if (boundedArtifacts.omittedCount > 0) uncertainty.push({ code: "artifact_details_truncated" })
  if (
    boundedAllowlist.omittedCount > 0 ||
    boundedBlocklist.omittedCount > 0 ||
    boundedExpectedOutputs.omittedCount > 0 ||
    boundedTargetFiles.omittedCount > 0 ||
    boundedTargetSubsystems.omittedCount > 0 ||
    boundedAvoidAreas.omittedCount > 0 ||
    boundedSensitivePatterns.omittedCount > 0 ||
    boundedForbiddenPatterns.omittedCount > 0 ||
    boundedValidationPlan.omittedCount > 0 ||
    boundedValidationCommands.omittedCount > 0 ||
    boundedEgressAllowHosts.omittedCount > 0
  ) {
    uncertainty.push({ code: "contract_details_truncated" })
  }
  if (contract.workflowClass === "worker_run") {
    uncertainty.push({
      code: "worker_action_details_unavailable",
      detail: "Canonical evidence records governed invocations and receipts, not worker-internal actions.",
    })
  }

  const result: RunInspectorProjectionV1 = {
    schemaVersion: "run-inspector.v1",
    kind: "canonical",
    runId,
    authority: {
      source: "event-log",
      validated: true,
      eventSequence: events.at(-1)!.seq,
      cursor: events.at(-1)!.eventId,
    },
    canonicalStatus: state.status,
    contract: {
      contractId: contract.contractId,
      ...(contract.contractInstanceId ? { contractInstanceId: contract.contractInstanceId } : {}),
      ...(contract.contractDigest ? { contractDigest: contract.contractDigest } : {}),
      workflowClass: contract.workflowClass,
      executionMode: contract.executionMode,
      riskLevel: contract.riskLevel,
      createdAt: contract.createdAt,
      timeoutMs: contract.timeoutMs,
      toolAllowlist: boundedAllowlist.items,
      toolAllowlistOmittedCount: boundedAllowlist.omittedCount,
      toolBlocklist: boundedBlocklist.items,
      toolBlocklistOmittedCount: boundedBlocklist.omittedCount,
      approvalPolicy: contract.approvalPolicy,
      limits: {
        maxFilesTouched: contract.runtimePolicy?.budgets.maxFilesTouched,
        maxMutatingCommands: contract.runtimePolicy?.budgets.maxMutatingCommands,
        maxApprovalRequests: contract.runtimePolicy?.budgets.maxApprovalRequests,
        maxRepeatedFailures: contract.runtimePolicy?.budgets.maxRepeatedFailures,
        scope: {
          targetFiles: { values: boundedTargetFiles.items, omittedCount: boundedTargetFiles.omittedCount },
          targetSubsystems: {
            values: boundedTargetSubsystems.items,
            omittedCount: boundedTargetSubsystems.omittedCount,
          },
          avoidAreas: { values: boundedAvoidAreas.items, omittedCount: boundedAvoidAreas.omittedCount },
        },
        sensitivity: {
          sensitivePatterns: {
            values: boundedSensitivePatterns.items,
            omittedCount: boundedSensitivePatterns.omittedCount,
          },
          forbiddenPatterns: {
            values: boundedForbiddenPatterns.items,
            omittedCount: boundedForbiddenPatterns.omittedCount,
          },
        },
        postconditions: {
          verificationRequired: contract.runtimePolicy?.postconditions.verificationRequired ?? false,
          validationPlan: { values: boundedValidationPlan.items, omittedCount: boundedValidationPlan.omittedCount },
          validationCommands: {
            values: boundedValidationCommands.items,
            omittedCount: boundedValidationCommands.omittedCount,
          },
        },
        egress: {
          filter: contract.runtimePolicy?.egress?.filter ?? true,
          allowHosts: { values: boundedEgressAllowHosts.items, omittedCount: boundedEgressAllowHosts.omittedCount },
        },
      },
    },
    invocationIntent: {
      intent: boundedText(contract.intent) ?? "",
      ...(contract.repoPath ? { repoPath: boundedText(contract.repoPath) } : {}),
      ...(contract.branch ? { branch: boundedText(contract.branch) } : {}),
      ...(contract.initiatedBy ? { initiatedBy: boundedText(contract.initiatedBy) } : {}),
      expectedOutputs: boundedExpectedOutputs.items.map((output) => ({
        type: output.type,
        description: boundedText(output.description) ?? "",
        ...(output.pathHint ? { pathHint: boundedText(output.pathHint) } : {}),
      })),
      expectedOutputsOmittedCount: boundedExpectedOutputs.omittedCount,
    },
    durableAuthorization: boundedInvocations,
    approvals: state.approvals.map((approval) => {
      const notes = bounded(approval.context?.notes ?? [])
      return {
        approvalId: approval.approvalId,
        type: approval.approvalType,
        risk: approval.risk,
        status: approval.status,
        ...(boundedText(approval.title) ? { title: boundedText(approval.title) } : {}),
        ...(boundedText(approval.reason) ? { reason: boundedText(approval.reason) } : {}),
        ...(boundedText(approval.expectedConsequence)
          ? { expectedConsequence: boundedText(approval.expectedConsequence) }
          : {}),
        ...(approval.stepId ? { stepId: approval.stepId } : {}),
        source: approval.source,
        context: approval.context
          ? {
              ...(approval.context.stepId ? { stepId: approval.context.stepId } : {}),
              ...(approval.context.filePath ? { filePath: boundedText(approval.context.filePath) } : {}),
              ...(approval.context.command ? { command: boundedText(approval.context.command) } : {}),
              ...(approval.context.toolName ? { toolName: boundedText(approval.context.toolName) } : {}),
              ...(approval.context.diffPreview ? { diffPreview: boundedText(approval.context.diffPreview) } : {}),
              ...(approval.context.notes
                ? {
                    notes: notes.items.map((note) => boundedText(note) ?? ""),
                    notesOmittedCount: notes.omittedCount,
                  }
                : {}),
              ...(approval.context.originalPermissionId
                ? { originalPermissionId: approval.context.originalPermissionId }
                : {}),
            }
          : null,
        requestedAt: approval.requestedAt,
        ...(approval.decidedAt ? { decidedAt: approval.decidedAt } : {}),
        ...(approval.decidedBy ? { decidedBy: boundedText(approval.decidedBy) } : {}),
        ...(boundedText(approval.comment) ? { comment: boundedText(approval.comment) } : {}),
        ...(approval.correlationId ? { correlationId: approval.correlationId } : {}),
      }
    }),
    outcome: {
      terminal:
        terminal && terminalOutcome
          ? { eventType: terminal.type, occurredAt: terminal.occurredAt, result: terminalOutcome }
          : null,
      unresolved: terminalOutcome
        ? null
        : {
            canonicalStatus: state.status,
            currentStepId: state.currentStepId,
            pendingApprovalIds: state.pendingApprovalIds.slice(0, MAX_COLLECTION_ITEMS),
          },
      error: state.error ? { code: state.error.code, retryable: state.error.retryable } : null,
    },
    mutationEvidence: {
      receiptIds: state.governance.mutationReceiptIds.slice(0, MAX_COLLECTION_ITEMS),
      changedPaths: state.governance.touchedFiles.slice(0, MAX_COLLECTION_ITEMS),
      receiptCount: state.governance.mutationReceiptIds.length,
      changedPathCount: state.governance.touchedFiles.length,
      items: boundedMutationRecords.items,
      omittedCount: boundedMutationRecords.omittedCount,
    },
    verificationEvidence: {
      required: state.governance.verification.required,
      satisfied: state.governance.verification.satisfied,
      receiptIds: state.governance.verification.receiptIds.slice(0, MAX_COLLECTION_ITEMS),
      checks: boundedVerificationChecks.items,
      checksOmittedCount: boundedVerificationChecks.omittedCount,
      receipts: boundedVerificationReceipts.items,
      receiptsOmittedCount: boundedVerificationReceipts.omittedCount,
    },
    artifactEvidence: boundedArtifacts,
    workerEvidence: {
      refinedContract: state.evidence.contract,
      sandbox: state.evidence.sandbox
        ? {
            provider: state.evidence.sandbox.provider,
            providerId: state.evidence.sandbox.providerId,
            filesystem: state.evidence.sandbox.filesystem,
            network: state.evidence.sandbox.network,
            reapedDescendants: state.evidence.sandbox.reapedDescendants,
            egress: state.evidence.sandbox.egress,
            egressEnforcement: state.evidence.sandbox.egressEnforcement,
            egressAllowHosts: {
              values: boundedSandboxEgressAllowHosts.items,
              omittedCount: boundedSandboxEgressAllowHosts.omittedCount,
            },
          }
        : null,
      egressDenialCount: state.evidence.egressDenials.length,
      egressDenials: boundedEgressDenials.items,
      egressDenialsOmittedCount: boundedEgressDenials.omittedCount,
    },
    completion: {
      terminalEvent: terminal ? { eventType: terminal.type, occurredAt: terminal.occurredAt } : null,
      genericCompletionProof: genericProof,
      workflowSpecificEvidence,
      integrityWarning,
    },
    uncertainty,
    chronology: { items: chronological, omittedCount: Math.max(0, events.length - chronological.length) },
  }
  return RunInspectorProjectionV1.parse(result)
}

export function authorityUnreadable(
  runId: string,
  reason: z.infer<typeof AuthorityUnreadable>["reason"],
): RunInspectorReadResultV1 {
  return { schemaVersion: "run-inspector.v1", kind: "authority_unreadable", runId, reason }
}

export function legacyUnsupported(
  runId: string,
  reason: z.infer<typeof LegacyUnsupported>["reason"],
): RunInspectorReadResultV1 {
  return { schemaVersion: "run-inspector.v1", kind: "legacy_unsupported", runId, reason }
}
