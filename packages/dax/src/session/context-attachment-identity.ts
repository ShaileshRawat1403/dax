import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

// These describe prompt-time, user-selected attachment effects. They are not
// native model-tool invocations and do not grant or modify read permission.
const registry = createCapabilityRegistry([
  { id: "session.context.attachment.stat", riskClass: "low", scopeSupport: "filesystem", requiresVerification: false },
  { id: "session.context.attachment.read", riskClass: "low", scopeSupport: "filesystem", requiresVerification: false },
  { id: "session.context.attachment.list", riskClass: "low", scopeSupport: "filesystem", requiresVerification: false },
  { id: "session.context.attachment.media", riskClass: "low", scopeSupport: "filesystem", requiresVerification: false },
])

export type ContextAttachmentOperation = "stat" | "read" | "list" | "media"
type Attachment = { type: string; url: string; mime: string; filename?: string }
type Snapshot = {
  part: Attachment
  url: string
  mime: string
  filename: string | undefined
  filepath: string
  operation: ContextAttachmentOperation
  executor: object
}

const bindings = new WeakMap<object, Snapshot>()
export type ContextAttachmentBinding = object

/** Capture the selected input and real executor, without exposing paths in the descriptor. */
export function bindContextAttachment(input: {
  part: Attachment
  filepath: string
  operation: ContextAttachmentOperation
  executor: object
}): ContextAttachmentBinding {
  if (input.part.type !== "file" || !input.part.url.startsWith("file:") || !input.filepath || !input.executor)
    throw new CapabilityIdentityError("malformed")
  registry.require(`session.context.attachment.${input.operation}`)
  const binding = Object.freeze({})
  bindings.set(binding, {
    part: input.part,
    url: input.part.url,
    mime: input.part.mime,
    filename: input.part.filename,
    filepath: input.filepath,
    operation: input.operation,
    executor: input.executor,
  })
  return binding
}

/** Recheck after each await, immediately before the selected filesystem effect. */
export function requireContextAttachment(input: {
  binding: ContextAttachmentBinding
  part: Attachment
  filepath: string
  operation: ContextAttachmentOperation
  executor: object
}): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  if (
    snapshot.part !== input.part ||
    input.part.type !== "file" ||
    snapshot.url !== input.part.url ||
    snapshot.mime !== input.part.mime ||
    snapshot.filename !== input.part.filename ||
    snapshot.filepath !== input.filepath ||
    snapshot.operation !== input.operation ||
    snapshot.executor !== input.executor
  )
    throw new CapabilityIdentityError("changed")
  return registry.require(`session.context.attachment.${snapshot.operation}`)
}

export function listContextAttachmentCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
