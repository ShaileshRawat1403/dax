import { redactEvidenceText } from "@/worker/evidence-redaction"

const MAX_PREVIEW_LENGTH = 8_192

/**
 * `sorted-json-v1`: recursively sorts object keys, omits undefined object
 * members, preserves array order. Matches the canonicalization named in
 * CanonicalInvocationInputSchema / CanonicalToolResultSchema.
 */
function sortedJsonV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonV1)
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      sorted[key] = sortedJsonV1(record[key])
    }
    return sorted
  }
  return value
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export type CanonicalCommitment = {
  canonicalization: "sorted-json-v1"
  digest: string
  redactedPreview: string
  truncated: boolean
}

/**
 * A commitment to validated data without making the append-only run log a raw
 * store. The digest is computed from the unredacted canonical JSON; only the
 * bounded preview handed back to callers is redacted, and `truncated`
 * describes that preview rather than the digest input.
 */
export async function computeCanonicalCommitment(value: unknown): Promise<CanonicalCommitment> {
  const canonicalJson = JSON.stringify(sortedJsonV1(value)) ?? "null"
  const digest = `sha256:${await sha256Hex(canonicalJson)}`
  const redacted = redactEvidenceText(canonicalJson)
  const truncated = redacted.length > MAX_PREVIEW_LENGTH
  const redactedPreview = truncated ? redacted.slice(0, MAX_PREVIEW_LENGTH) : redacted
  return { canonicalization: "sorted-json-v1", digest, redactedPreview: redactedPreview || "null", truncated }
}
