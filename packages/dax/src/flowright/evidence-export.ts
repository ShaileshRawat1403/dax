import { createHash } from "node:crypto"
import z from "zod"
import type { ApprovalRecord, ArtifactRecord, RunEvent, RunSnapshot } from "@/server/run-contract"

/**
 * runledger.evidence.v0 export — DAX conformance to the shared evidence
 * schema (flowright repo: docs/architecture/runledger-evidence-schema.md).
 *
 * The schema is the EXPORT shape, not DAX's storage: DAX keeps its own audit
 * chain and event log; this module projects them into ordered v0 records
 * whose bundle digest is what capability receipts publish as
 * `evidenceDigest`. That makes receipt verification mechanical for the
 * caller: fetch the records, recompute, compare.
 *
 * Canonicalization matches Flowright's `canonicalJson` byte-for-byte:
 * object keys sorted lexicographically, `undefined` members dropped,
 * arrays kept in order.
 */

export const RUNLEDGER_EVIDENCE_SCHEMA_VERSION = "runledger.evidence.v0"

export const EvidenceClass = z.enum([
  "tool_output_capture",
  "artifact_snapshot",
  "artifact_diff",
  "verification_run",
  "model_generation_record",
  "human_decision_record",
  "state_transition",
])
export type EvidenceClass = z.infer<typeof EvidenceClass>

export const EvidenceRecordV0 = z
  .object({
    schemaVersion: z.literal(RUNLEDGER_EVIDENCE_SCHEMA_VERSION),
    id: z.string(),
    producer: z.object({ system: z.string(), component: z.string() }),
    subject: z.object({
      runId: z.string(),
      stepId: z.string().optional(),
      artifactId: z.string().optional(),
      invocationId: z.string().optional(),
    }),
    class: EvidenceClass,
    payload: z.record(z.string(), z.any()),
    provenance: z.object({
      actorKind: z.enum(["human", "kernel", "model", "tool"]),
      actorId: z.string().optional(),
    }),
    createdAt: z.string(),
    integrity: z.object({ bodyDigest: z.string(), prevDigest: z.string().optional() }),
  })
  .meta({ ref: "RunledgerEvidenceRecordV0" })
export type EvidenceRecordV0 = z.infer<typeof EvidenceRecordV0>

export const EvidenceExportResponse = z
  .object({
    schemaVersion: z.literal(RUNLEDGER_EVIDENCE_SCHEMA_VERSION),
    runId: z.string(),
    invocationId: z.string().optional(),
    bundleDigest: z.string(),
    records: z.array(EvidenceRecordV0),
  })
  .meta({ ref: "RunledgerEvidenceExportV0" })
export type EvidenceExportResponse = z.infer<typeof EvidenceExportResponse>

// --- canonicalization (must match Flowright's canonicalJson) ---------------

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`
}

export function computeBodyDigest(record: Omit<EvidenceRecordV0, "integrity">): string {
  return sha256(canonicalJson(record))
}

export function computeBundleDigest(records: EvidenceRecordV0[]): string {
  return sha256(canonicalJson(records.map((record) => record.integrity.bodyDigest)))
}

// --- record construction ----------------------------------------------------

type ExportInput = {
  snapshot: RunSnapshot
  approvals: ApprovalRecord[]
  artifacts: ArtifactRecord[]
  events: RunEvent[]
  invocationId?: string
}

type RecordBody = Omit<EvidenceRecordV0, "integrity">

function body(input: ExportInput, partial: Omit<RecordBody, "schemaVersion" | "producer" | "subject"> & { subjectExtras?: Partial<RecordBody["subject"]> }): RecordBody {
  const { subjectExtras, ...rest } = partial
  return {
    schemaVersion: RUNLEDGER_EVIDENCE_SCHEMA_VERSION,
    producer: { system: "dax", component: "evidence-export" },
    subject: {
      runId: input.snapshot.runId,
      ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      ...subjectExtras,
    },
    ...rest,
  }
}

/**
 * Project DAX run data into ordered runledger.evidence.v0 records.
 *
 * Deliberate honesty rules (the schema doing its job):
 * - state_transition records come only from run.state_changed events, which
 *   carry real previous/current statuses. Nothing is synthesized.
 * - approvals become human_decision_record ONLY when a resolution with a
 *   real actorId exists. Approvals resolved without actor identity produce
 *   no human-authority evidence — that absence is itself signal.
 * - artifact snapshots use the stored content digest when present; otherwise
 *   the digest covers the artifact descriptor and says so via digestScope,
 *   never pretending to attest content it hasn't hashed.
 */
export function buildEvidenceRecords(input: ExportInput): EvidenceRecordV0[] {
  const bodies: RecordBody[] = []

  for (const event of input.events) {
    if (event.type === "run.state_changed") {
      const payload = event.payload as { previousStatus?: string; currentStatus?: string; reason?: string }
      if (payload.previousStatus && payload.currentStatus) {
        bodies.push(
          body(input, {
            id: `ev-${event.eventId}`,
            class: "state_transition",
            payload: {
              from: payload.previousStatus,
              to: payload.currentStatus,
              event: event.type,
              ...(payload.reason ? { reason: payload.reason } : {}),
              sequence: event.sequence,
            },
            provenance: { actorKind: "kernel" },
            createdAt: event.timestamp,
          }),
        )
      }
    }
  }

  for (const artifact of input.artifacts) {
    const storedDigest = typeof artifact.metadata?.digest === "string" ? artifact.metadata.digest : undefined
    bodies.push(
      body(input, {
        id: `ev-artifact-${artifact.artifactId}`,
        class: "artifact_snapshot",
        subjectExtras: { artifactId: artifact.artifactId },
        payload: storedDigest
          ? { contentDigest: storedDigest, digestScope: "content", artifactType: artifact.type, title: artifact.title }
          : {
              contentDigest: sha256(
                canonicalJson({ artifactId: artifact.artifactId, type: artifact.type, title: artifact.title, createdAt: artifact.createdAt, path: artifact.path }),
              ),
              digestScope: "descriptor",
              artifactType: artifact.type,
              title: artifact.title,
            },
        provenance: { actorKind: "kernel" },
        createdAt: artifact.createdAt,
      }),
    )
  }

  for (const approval of input.approvals) {
    const resolution = approval.resolution
    if (!resolution || !resolution.actorId) continue
    bodies.push(
      body(input, {
        id: `ev-approval-${approval.approvalId}`,
        class: "human_decision_record",
        payload: {
          decision: resolution.decision,
          gateId: approval.approvalId,
          gateType: approval.type,
          risk: approval.risk,
          title: approval.title,
          ...(resolution.comment ? { comment: resolution.comment } : {}),
          source: resolution.source,
        },
        provenance: { actorKind: "human", actorId: resolution.actorId },
        createdAt: approval.resolvedAt ?? approval.updatedAt,
      }),
    )
  }

  // Deterministic order: createdAt, then id as tiebreaker.
  bodies.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  const records: EvidenceRecordV0[] = []
  let prevDigest: string | undefined
  for (const recordBody of bodies) {
    const bodyDigest = computeBodyDigest(recordBody)
    records.push({ ...recordBody, integrity: { bodyDigest, ...(prevDigest ? { prevDigest } : {}) } })
    prevDigest = bodyDigest
  }
  return records
}

export function buildEvidenceExport(input: ExportInput): EvidenceExportResponse {
  const records = buildEvidenceRecords(input)
  return {
    schemaVersion: RUNLEDGER_EVIDENCE_SCHEMA_VERSION,
    runId: input.snapshot.runId,
    ...(input.invocationId ? { invocationId: input.invocationId } : {}),
    bundleDigest: computeBundleDigest(records),
    records,
  }
}
