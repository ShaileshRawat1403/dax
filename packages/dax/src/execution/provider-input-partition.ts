import { createHash } from "node:crypto"

export const PROVIDER_INPUT_PARTITION_CANONICALIZATION = "provider-semantic-input-v1" as const
export const PROVIDER_INPUT_ATOM_CANONICALIZATION = "provider-semantic-atom-v1" as const

export type ProviderInputAtomLocation =
  | { kind: "message_envelope"; message: number }
  | { kind: "message_content"; message: number; part: number }
  | { kind: "tool"; index: number }
  | { kind: "provider_instruction"; index: number }

export type ProviderInputAtomOwner = "instruction" | "context"
export type ProviderInputAtomOrigin = "source_exact" | "dax_derived" | "transform_output"

export type ProviderInputAtom = {
  ordinal: number
  location: ProviderInputAtomLocation
  owner: ProviderInputAtomOwner
  kind:
    | "message_envelope"
    | "text"
    | "reasoning"
    | "file"
    | "image"
    | "tool_call"
    | "tool_result"
    | "content"
    | "tool_definition"
    | "provider_instruction"
    | "other"
  role?: "system" | "user" | "assistant" | "tool"
  origin: ProviderInputAtomOrigin
  sourceOrdinals: number[]
  canonicalization: typeof PROVIDER_INPUT_ATOM_CANONICALIZATION
  digest: string
  canonicalBytes: number
}

export type ProviderInputPartition = {
  canonicalization: typeof PROVIDER_INPUT_PARTITION_CANONICALIZATION
  digest: string
  atomCount: number
  instructionAtomOrdinals: number[]
  contextAtomOrdinals: number[]
  atoms: ProviderInputAtom[]
}

export type ProviderInputSourceCandidate = {
  locator: { message: number; part?: number }
  kind: ProviderInputAtom["kind"]
  origin: Exclude<ProviderInputAtomOrigin, "transform_output">
  sourceOrdinal: number
  value: unknown
}

export function opaqueProviderInputSources(
  messages: unknown[],
  origin: Exclude<ProviderInputAtomOrigin, "transform_output"> = "dax_derived",
): ProviderInputSourceCandidate[] {
  const result: ProviderInputSourceCandidate[] = []
  let sourceOrdinal = 0
  for (const [message, value] of messages.entries()) {
    if (!value || typeof value !== "object") continue
    const record = value as Record<string, unknown>
    const { content, ...envelope } = record
    result.push({
      locator: { message },
      kind: "message_envelope",
      origin,
      sourceOrdinal: sourceOrdinal++,
      value: envelope,
    })
    const parts = Array.isArray(content) ? content : [content]
    for (const [part, item] of parts.entries()) {
      result.push({
        locator: { message, part },
        kind: providerInputAtomKind(item),
        origin,
        sourceOrdinal: sourceOrdinal++,
        value: item,
      })
    }
  }
  return result
}

type InstructionLocator = { message: number; part?: number }

function sha256(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function frame(tag: string, chunks: Uint8Array[]): Uint8Array {
  const encoder = new TextEncoder()
  const tagBytes = encoder.encode(tag)
  const total = 4 + tagBytes.byteLength + chunks.reduce((sum, chunk) => sum + 8 + chunk.byteLength, 0)
  const output = new Uint8Array(total)
  const view = new DataView(output.buffer)
  let offset = 0
  view.setUint32(offset, tagBytes.byteLength)
  offset += 4
  output.set(tagBytes, offset)
  offset += tagBytes.byteLength
  for (const chunk of chunks) {
    view.setBigUint64(offset, BigInt(chunk.byteLength))
    offset += 8
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function strictBase64(value: string): Uint8Array | null {
  const compact = value.replace(/\s/g, "")
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null
  const unpadded = compact.replace(/=+$/, "")
  if (unpadded.includes("=")) return null
  const padded = unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=")
  const decoded = Buffer.from(padded, "base64")
  if (decoded.toString("base64").replace(/=+$/, "") !== unpadded) return null
  return decoded
}

function percentEncodedBytes(value: string): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: number[] = []
  for (let index = 0; index < value.length; ) {
    if (value[index] === "%") {
      const hex = value.slice(index + 1, index + 3)
      if (!/^[a-fA-F0-9]{2}$/.test(hex)) throw new Error("Malformed typed media percent encoding")
      chunks.push(Number.parseInt(hex, 16))
      index += 3
      continue
    }
    const codePoint = value.codePointAt(index)
    if (codePoint === undefined) break
    const character = String.fromCodePoint(codePoint)
    chunks.push(...encoder.encode(character))
    index += character.length
  }
  return Uint8Array.from(chunks)
}

function typedMediaString(key: string | null, parentType: string | null, value: string): Uint8Array | null {
  const typed = parentType === "file" || parentType === "image" || parentType === "media"
  if (!typed || (key !== "data" && key !== "image" && key !== "url")) return null
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",")
    if (comma === -1) throw new Error("Malformed typed media data URL")
    const header = value.slice(5, comma)
    const payload = value.slice(comma + 1)
    const segments = header.split(";")
    const mediaType = segments.shift() ?? ""
    const isBase64 = segments.at(-1)?.toLowerCase() === "base64"
    const parameters = isBase64 ? segments.slice(0, -1) : segments
    let bytes: Uint8Array
    if (isBase64) {
      const decoded = strictBase64(payload)
      if (!decoded) throw new Error("Malformed typed media base64 payload")
      bytes = decoded
    } else {
      bytes = percentEncodedBytes(payload)
    }
    return frame("typed-media-data-url", [
      new TextEncoder().encode(mediaType.toLowerCase()),
      new TextEncoder().encode(parameters.join(";")),
      bytes,
    ])
  }
  if (key === "data" || key === "image") {
    if (/^https?:\/\//i.test(value)) {
      return frame("typed-media-reference", [new TextEncoder().encode(new URL(value).toString())])
    }
    const decoded = strictBase64(value)
    if (decoded) return frame("typed-media-bytes", [decoded])
    if (key === "data") throw new Error("Malformed typed media base64 field")
  }
  return frame("typed-media-reference", [new TextEncoder().encode(value)])
}

function canonicalBytes(
  value: unknown,
  key: string | null = null,
  parentType: string | null = null,
  allowTypedMediaRoot = false,
): Uint8Array {
  const encoder = new TextEncoder()
  if (value === null) return frame("null", [])
  if (typeof value === "string") {
    const media = typedMediaString(key, parentType, value)
    return media ?? frame("string", [encoder.encode(value)])
  }
  if (typeof value === "boolean") return frame(value ? "true" : "false", [])
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite provider input number")
    return frame("number", [encoder.encode(Object.is(value, -0) ? "-0" : String(value))])
  }
  if (typeof value === "bigint") return frame("bigint", [encoder.encode(value.toString())])
  if (value instanceof Uint8Array) {
    if (!(parentType === "file" || parentType === "image" || parentType === "media")) {
      throw new Error("Binary provider input is only accepted in typed media fields")
    }
    return frame("typed-media-bytes", [value])
  }
  if (value instanceof ArrayBuffer) {
    if (!(parentType === "file" || parentType === "image" || parentType === "media")) {
      throw new Error("Binary provider input is only accepted in typed media fields")
    }
    return frame("typed-media-bytes", [new Uint8Array(value)])
  }
  if (value instanceof URL) {
    if (!(parentType === "file" || parentType === "image" || parentType === "media")) {
      throw new Error("URL provider input is only accepted in typed media fields")
    }
    return frame("typed-media-reference", [encoder.encode(value.toString())])
  }
  if (Array.isArray(value))
    return frame(
      "array",
      value.map((item) => canonicalBytes(item, null, null, false)),
    )
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Unsupported provider input object type: ${value.constructor?.name ?? "unknown"}`)
    }
    const record = value as Record<string, unknown>
    // Media decoding is allowed only when the value itself occupies a typed
    // provider-content position. Nested objects inside tool input/output are
    // ordinary JSON even when they happen to contain `{ type: "file" }`.
    const type =
      allowTypedMediaRoot &&
      typeof record.type === "string" &&
      (record.type === "file" || record.type === "image" || record.type === "media")
        ? record.type
        : null
    const chunks: Uint8Array[] = []
    for (const name of Object.keys(record).sort()) {
      const item = record[name]
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue
      chunks.push(frame("entry", [encoder.encode(name), canonicalBytes(item, name, type, false)]))
    }
    return frame("object", chunks)
  }
  throw new Error(`Unsupported provider input value: ${typeof value}`)
}

export function commitProviderInputValue(value: unknown, kind: ProviderInputAtom["kind"] = "other") {
  const bytes = canonicalBytes(value, null, null, kind === "file" || kind === "image")
  return {
    canonicalization: PROVIDER_INPUT_ATOM_CANONICALIZATION,
    digest: sha256(bytes),
    canonicalBytes: bytes.byteLength,
  }
}

function locationKey(location: ProviderInputAtomLocation): string {
  switch (location.kind) {
    case "message_envelope":
      return `e:${location.message}`
    case "message_content":
      return `c:${location.message}:${location.part}`
    case "tool":
      return `t:${location.index}`
    case "provider_instruction":
      return `p:${location.index}`
  }
}

export function providerInputAtomKind(value: unknown): ProviderInputAtom["kind"] {
  if (typeof value === "string") return "text"
  if (!value || typeof value !== "object") return "other"
  const type = String((value as { type?: unknown }).type ?? "")
  if (type === "text") return "text"
  if (type === "reasoning") return "reasoning"
  if (type === "file" || type === "media") return "file"
  if (type === "image") return "image"
  if (type === "tool-call") return "tool_call"
  if (type === "tool-result") return "tool_result"
  return type ? "content" : "other"
}

function providerInstructions(value: unknown): unknown[] {
  const result: unknown[] = []
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== "object") return
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key === "instructions" && child !== undefined) result.push(child)
      else visit(child)
    }
  }
  visit(value)
  return result
}

function adapterTools(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== "object") return []
  return Object.values(value as Record<string, unknown>)
}

function manifestDigest(atoms: ProviderInputAtom[]): string {
  const material = atoms.map((atom) => ({
    ordinal: atom.ordinal,
    location: atom.location,
    owner: atom.owner,
    kind: atom.kind,
    ...(atom.role ? { role: atom.role } : {}),
    origin: atom.origin,
    sourceOrdinals: atom.sourceOrdinals,
    canonicalization: atom.canonicalization,
    digest: atom.digest,
    canonicalBytes: atom.canonicalBytes,
  }))
  return sha256(canonicalBytes(material))
}

export function recomputeProviderInputPartitionDigest(atoms: ProviderInputAtom[]): string {
  return manifestDigest(atoms)
}

export function buildProviderInputPartition(input: {
  prompt: unknown
  tools: unknown
  providerOptions: unknown
  instructionLocators: InstructionLocator[]
  sources?: ProviderInputSourceCandidate[]
}): ProviderInputPartition {
  const messages = Array.isArray(input.prompt) ? input.prompt : []
  const claimed = new Set(input.instructionLocators.map((location) => `${location.message}:${location.part ?? "*"}`))
  const sources = new Map(
    (input.sources ?? []).map((source) => [`${source.locator.message}:${source.locator.part ?? "*"}`, source]),
  )
  const atoms: ProviderInputAtom[] = []
  const add = (details: {
    location: ProviderInputAtomLocation
    owner: ProviderInputAtomOwner
    kind: ProviderInputAtom["kind"]
    role?: ProviderInputAtom["role"]
    value: unknown
    source?: ProviderInputSourceCandidate
  }) => {
    const commitment = commitProviderInputValue(details.value, details.kind)
    const sourceCommitment = details.source ? commitProviderInputValue(details.source.value, details.source.kind) : null
    const sourceSurvived = Boolean(sourceCommitment && sourceCommitment.digest === commitment.digest)
    atoms.push({
      ordinal: atoms.length,
      location: details.location,
      owner: details.owner,
      kind: details.kind,
      ...(details.role ? { role: details.role } : {}),
      origin: sourceSurvived ? details.source!.origin : "transform_output",
      sourceOrdinals: sourceSurvived ? [details.source!.sourceOrdinal] : [],
      ...commitment,
    })
  }

  for (const [messageIndex, raw] of messages.entries()) {
    if (!raw || typeof raw !== "object") throw new Error(`Provider prompt message ${messageIndex} is not an object`)
    const message = raw as Record<string, unknown>
    const role = String(message.role ?? "")
    if (!(["system", "user", "assistant", "tool"] as string[]).includes(role)) {
      throw new Error(`Unsupported provider prompt role at message ${messageIndex}`)
    }
    const typedRole = role as ProviderInputAtom["role"]
    const { content: _content, ...envelope } = message
    add({
      location: { kind: "message_envelope", message: messageIndex },
      owner: role === "system" ? "instruction" : "context",
      kind: "message_envelope",
      role: typedRole,
      value: envelope,
      source: sources.get(`${messageIndex}:*`),
    })
    const content = message.content
    const parts = Array.isArray(content) ? content : [content]
    for (const [partIndex, part] of parts.entries()) {
      const owner =
        role === "system" || claimed.has(`${messageIndex}:${partIndex}`) || claimed.has(`${messageIndex}:*`)
          ? "instruction"
          : "context"
      add({
        location: { kind: "message_content", message: messageIndex, part: partIndex },
        owner,
        kind: providerInputAtomKind(part),
        role: typedRole,
        value: part,
        source: sources.get(`${messageIndex}:${partIndex}`),
      })
    }
  }

  for (const [index, tool] of adapterTools(input.tools).entries()) {
    add({
      location: { kind: "tool", index },
      owner: "instruction",
      kind: "tool_definition",
      value: tool,
    })
  }
  for (const [index, instruction] of providerInstructions(input.providerOptions).entries()) {
    add({
      location: { kind: "provider_instruction", index },
      owner: "instruction",
      kind: "provider_instruction",
      value: instruction,
    })
  }

  const locations = atoms.map((atom) => locationKey(atom.location))
  if (new Set(locations).size !== locations.length) throw new Error("Provider input atom locations are not unique")
  const instructionAtomOrdinals = atoms.filter((atom) => atom.owner === "instruction").map((atom) => atom.ordinal)
  const contextAtomOrdinals = atoms.filter((atom) => atom.owner === "context").map((atom) => atom.ordinal)
  return {
    canonicalization: PROVIDER_INPUT_PARTITION_CANONICALIZATION,
    digest: manifestDigest(atoms),
    atomCount: atoms.length,
    instructionAtomOrdinals,
    contextAtomOrdinals,
    atoms,
  }
}
