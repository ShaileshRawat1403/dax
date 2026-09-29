import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

// Resolving an @reference performs a filesystem stat before it can become an
// attachment or an agent reference. This describes that effect, not permission
// to read the resulting file or to execute the selected agent.
const registry = createCapabilityRegistry([
  { id: "session.context.template.stat", riskClass: "low", scopeSupport: "filesystem", requiresVerification: false },
])

type Snapshot = {
  reference: string
  filepath: string
  executor: object
}

const bindings = new WeakMap<object, Snapshot>()
export type TemplateContextBinding = object

export function bindTemplateContext(input: Snapshot): TemplateContextBinding {
  if (!input.reference || !input.filepath || typeof input.executor !== "function")
    throw new CapabilityIdentityError("malformed")
  registry.require("session.context.template.stat")
  const binding = Object.freeze({})
  bindings.set(binding, { ...input })
  return binding
}

export function requireTemplateContext(input: Snapshot & { binding: TemplateContextBinding }): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  if (
    snapshot.reference !== input.reference ||
    snapshot.filepath !== input.filepath ||
    snapshot.executor !== input.executor
  )
    throw new CapabilityIdentityError("changed")
  return registry.require("session.context.template.stat")
}

export function listTemplateContextCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
