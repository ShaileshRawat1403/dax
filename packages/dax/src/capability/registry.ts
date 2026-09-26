import { CapabilityDescriptor } from "./capability-types"

/** A validated immutable vocabulary, never an authorization resolver. */
export function createCapabilityRegistry(descriptors: readonly unknown[]) {
  const entries = new Map<string, CapabilityDescriptor>()
  for (const input of descriptors) {
    const descriptor = Object.freeze(CapabilityDescriptor.parse(input))
    if (entries.has(descriptor.id)) throw new Error(`Duplicate capability: ${descriptor.id}`)
    entries.set(descriptor.id, descriptor)
  }
  return Object.freeze({
    require(id: string): CapabilityDescriptor {
      const descriptor = entries.get(id)
      if (!descriptor) throw new Error(`Unknown capability: ${id}`)
      return descriptor
    },
    list(): readonly CapabilityDescriptor[] {
      return Object.freeze([...entries.values()])
    },
  })
}

// Only enrolled model-tool executors. Prompt-time context reads, commands,
// plugins/MCP, graph operators, workflows and workers are separate followups.
// Properties describe intrinsic effects; existing policy remains authoritative.
const nativeProperties = {
  invalid: ["low", "none", false],
  question: ["low", "none", false],
  shell: ["high", "opaque", true],
  read: ["low", "filesystem", false],
  glob: ["low", "filesystem", false],
  grep: ["low", "filesystem", false],
  edit: ["high", "filesystem", true],
  write: ["high", "filesystem", true],
  apply_patch: ["high", "filesystem", true],
  task: ["high", "delegation", true],
  webfetch: ["medium", "opaque", false],
  websearch: ["medium", "opaque", false],
  codesearch: ["medium", "opaque", false],
  todowrite: ["medium", "none", false],
  pm_note: ["medium", "none", false],
  skill: ["low", "filesystem", false],
  git_branch: ["high", "opaque", true],
  lsp: ["medium", "filesystem", false],
  batch: ["high", "opaque", true],
  plan_enter: ["medium", "none", false],
  plan_exit: ["medium", "none", false],
  reflection: ["low", "none", false],
} as const

export const nativeCapabilities = createCapabilityRegistry(
  Object.entries(nativeProperties).map(([toolID, [riskClass, scopeSupport, requiresVerification]]) => ({
    id: `native.tool.${toolID}`,
    riskClass,
    scopeSupport,
    requiresVerification,
  })),
)
