import { createHash } from "crypto"

/**
 * Hash chain for the RAO audit ledger.
 *
 * This must produce byte-identical digests to `crates/dax-ledger`. The Rust
 * crate is the independent verifier: two implementations of one written format,
 * cross-checked by a pinned vector in both test suites. Changing the material
 * that goes into a hash is a versioned decision, not a refactor.
 *
 * Canonicalization: object keys sorted by UTF-8 byte order (what Rust's
 * `keys.sort()` does), arrays kept in order, then serialized compactly.
 */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareUtf8(left, right),
    )
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`
}

export const LEDGER_ENTRY_SCHEMA_VERSION = "dax.ledger.entry.v1"

export function bodyHash(body: unknown): string {
  return sha256(canonicalJson(body))
}

/**
 * Binds the whole entry header, not just the body: a timestamp outside the
 * hash is a timestamp anyone can rewrite.
 */
export function chainHash(input: {
  prevHash: string
  bodyHash: string
  seq: number
  ts: string
  schemaVersion?: string
}): string {
  return sha256(
    canonicalJson({
      schemaVersion: input.schemaVersion ?? LEDGER_ENTRY_SCHEMA_VERSION,
      seq: input.seq,
      ts: input.ts,
      prevHash: input.prevHash,
      bodyHash: input.bodyHash,
    }),
  )
}

export type ChainLink = {
  seq: number
  ts: string
  prevHash: string
  bodyHash: string
  chainHash: string
}

export function link(prev: ChainLink | undefined, body: unknown, ts: string): ChainLink {
  const seq = prev ? prev.seq + 1 : 0
  const prevHash = prev ? prev.chainHash : ""
  const body_hash = bodyHash(body)
  return {
    seq,
    ts,
    prevHash,
    bodyHash: body_hash,
    chainHash: chainHash({ prevHash, bodyHash: body_hash, seq, ts }),
  }
}

export type VerifyFailure = {
  seq: number
  reason: string
}

export function verify(entries: ChainLink[] & { body?: unknown }[], bodies: unknown[]): VerifyFailure | undefined {
  let prev: ChainLink | undefined
  for (const [index, entry] of entries.entries()) {
    const expectedSeq = prev ? prev.seq + 1 : 0
    if (entry.seq !== expectedSeq) {
      return { seq: entry.seq, reason: `sequence gap: expected ${expectedSeq}, got ${entry.seq}` }
    }
    const expectedPrev = prev ? prev.chainHash : ""
    if (entry.prevHash !== expectedPrev) {
      return { seq: entry.seq, reason: "prevHash does not match the previous chainHash" }
    }
    if (entry.bodyHash !== bodyHash(bodies[index])) {
      return { seq: entry.seq, reason: "body has been modified since it was recorded" }
    }
    if (entry.chainHash !== chainHash(entry)) {
      return { seq: entry.seq, reason: "chainHash does not match the entry header" }
    }
    prev = entry
  }
  return undefined
}
