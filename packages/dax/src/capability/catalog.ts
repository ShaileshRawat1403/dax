import { MCP } from "@/mcp"
import { MCP_PROMPT_NAMESPACE, MCP_RESOURCE_NAMESPACE } from "@/mcp/resource-identity"
import { listBuiltinOperatorCapabilities } from "@/operators/capability-identity"
import { listVerificationCommandCapabilities } from "@/sdlc/verification-identity"
import { listCommandShellCapabilities } from "@/session/command-shell-identity"
import { listContextAttachmentCapabilities } from "@/session/context-attachment-identity"
import { listOperatorShellCapabilities } from "@/session/operator-shell-identity"
import { listTemplateContextCapabilities } from "@/session/template-context-identity"
import { ToolRegistry } from "@/tool/registry"
import { listBuiltinWorkerCapabilities } from "@/worker/worker-adapter"
import { listFixedWorkflowCapabilities } from "@/workflows/capability-identity"
import type { CapabilityDescriptor } from "./capability-types"
import { MCP_TOOL_NAMESPACE, PLUGIN_TOOL_NAMESPACE } from "./dynamic-identity"
import { nativeCapabilities } from "./registry"
import { composeCapabilityVocabulary, type CapabilityFamily } from "./vocabulary"

/**
 * The declared population of DAX-dispatched capability families.
 *
 * Each family keeps its own registry next to the executor it describes; this
 * module only composes them. It is a leaf: nothing on a dispatch path imports
 * it, so composing the vocabulary cannot change what runs.
 *
 * Not in the population, by decision: trusted plugin loading and hooks (identity
 * cannot contain arbitrary in-process code), formatter/LSP/MCP process launches
 * (service lifecycle effects), and legacy `ToolRegistry.register` and
 * caller-supplied graph operators (compatible, unenrolled).
 */
function staticFamilies(): CapabilityFamily[] {
  const listed = (name: string, namespace: string, descriptors: readonly CapabilityDescriptor[]) =>
    ({ name, namespace, enumeration: "listed", descriptors }) satisfies CapabilityFamily
  return [
    listed("native_tool", "native.tool.", nativeCapabilities.list()),
    listed("operator", "operator.", listBuiltinOperatorCapabilities()),
    listed("workflow", "workflow.", listFixedWorkflowCapabilities()),
    listed("worker", "worker.profile.", listBuiltinWorkerCapabilities()),
    listed("command_shell", "session.command.", listCommandShellCapabilities()),
    listed("operator_shell", "session.shell.", listOperatorShellCapabilities()),
    listed("context_attachment", "session.context.attachment.", listContextAttachmentCapabilities()),
    listed("template_context", "session.context.template.", listTemplateContextCapabilities()),
    listed("verification_command", "verification.command.", listVerificationCommandCapabilities()),
    { name: "mcp_resource", namespace: MCP_RESOURCE_NAMESPACE, enumeration: "on_demand", descriptors: [] },
    { name: "mcp_prompt", namespace: MCP_PROMPT_NAMESPACE, enumeration: "on_demand", descriptors: [] },
  ]
}

export namespace CapabilityCatalog {
  /** Process-independent families only; loader and MCP tool families are listed empty. */
  export function staticVocabulary() {
    return compose([], [])
  }

  /**
   * A snapshot for the current instance: static families plus whatever this
   * instance's loader and MCP catalogs currently hold as valid. It performs no
   * discovery, holds no reference that outlives the call, and a later
   * invalidation or disposal is simply absent from the next snapshot.
   */
  export async function snapshot() {
    return compose(ToolRegistry.capabilities(), await MCP.capabilities())
  }

  function compose(plugin: readonly CapabilityDescriptor[], mcp: readonly CapabilityDescriptor[]) {
    return composeCapabilityVocabulary([
      ...staticFamilies(),
      { name: "plugin_tool", namespace: PLUGIN_TOOL_NAMESPACE, enumeration: "listed", descriptors: plugin },
      { name: "mcp_tool", namespace: MCP_TOOL_NAMESPACE, enumeration: "listed", descriptors: mcp },
    ])
  }
}
