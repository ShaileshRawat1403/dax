import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import type { Command } from "@/command"
import { ConfigMarkdown } from "@/config/markdown"

// Describes command-template shell dispatch, not permission to run a command.
const registry = createCapabilityRegistry([
  { id: "session.command.shell", riskClass: "high", scopeSupport: "opaque", requiresVerification: true },
])

type Snapshot = {
  command: Command.Info
  selectedName: string
  template: string
  snippets: readonly string[]
}

const bindings = new WeakMap<object, Snapshot>()
export type CommandShellBinding = object

/** Bind the selected loader result to the exact shell snippets sent to permission review. */
export function bindCommandShell(input: {
  command: Command.Info
  selectedName: string
  template: string
  snippets: readonly string[]
}): CommandShellBinding {
  const parsed = ConfigMarkdown.shell(input.template).map((match) => match[1])
  if (
    input.command.name !== input.selectedName ||
    !parsed.length ||
    parsed.length !== input.snippets.length ||
    parsed.some((snippet, index) => !snippet || snippet !== input.snippets[index])
  )
    throw new CapabilityIdentityError("malformed")

  registry.require("session.command.shell")
  const binding = Object.freeze({})
  bindings.set(binding, {
    command: input.command,
    selectedName: input.selectedName,
    template: input.template,
    snippets: Object.freeze([...input.snippets]),
  })
  return binding
}

/** Recheck after awaited approval and sandbox setup, immediately before shell effects. */
export function requireCommandShellCapability(input: {
  binding: CommandShellBinding
  command: Command.Info
  selectedName: string
  template: string
  index: number
  snippet: string
}): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  if (
    snapshot.command !== input.command ||
    snapshot.selectedName !== input.selectedName ||
    input.command.name !== input.selectedName ||
    snapshot.template !== input.template ||
    snapshot.snippets[input.index] !== input.snippet
  )
    throw new CapabilityIdentityError("changed")
  return registry.require("session.command.shell")
}

export function listCommandShellCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
