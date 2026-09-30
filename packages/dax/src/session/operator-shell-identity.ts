import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

// Describes the operator's direct session shell, not permission to run a command.
// It is a separate identity from the model's shell tool and from command-template
// shell: the operator typed this command, and no model selected it.
const registry = createCapabilityRegistry([
  { id: "session.shell.operator", riskClass: "high", scopeSupport: "opaque", requiresVerification: true },
])

type Snapshot = {
  sessionID: string
  command: string
  executor: object
}

const bindings = new WeakMap<object, Snapshot>()
export type OperatorShellBinding = object

/** Bind the submitted command and the process launcher before any awaited setup. */
export function bindOperatorShell(input: Snapshot): OperatorShellBinding {
  if (!input.sessionID || typeof input.command !== "string" || typeof input.executor !== "function")
    throw new CapabilityIdentityError("malformed")
  registry.require("session.shell.operator")
  const binding = Object.freeze({})
  bindings.set(binding, { ...input })
  return binding
}

/** Recheck after awaited session writes and hooks, immediately before the shell effect. */
export function requireOperatorShellCapability(input: Snapshot & { binding: OperatorShellBinding }): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  if (
    snapshot.sessionID !== input.sessionID ||
    snapshot.command !== input.command ||
    snapshot.executor !== input.executor
  )
    throw new CapabilityIdentityError("changed")
  return registry.require("session.shell.operator")
}

export function listOperatorShellCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
