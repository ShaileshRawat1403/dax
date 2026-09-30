import { EDIT_TOOL_IDS, READ_TOOL_IDS, SHELL_TOOL_IDS, permissionForToolId } from "@/tool/tool-class"
import { nativeCapabilities } from "./registry"

const NATIVE_PREFIX = "native.tool."

// Every name that denotes a DAX built-in: the enrolled native tools, and the
// legacy and defensive aliases the classifier treats as edit, shell or read.
const nativeAliases = new Set<string>([
  ...nativeCapabilities.list().map((descriptor) => descriptor.id.slice(NATIVE_PREFIX.length)),
  ...EDIT_TOOL_IDS,
  ...SHELL_TOOL_IDS,
  ...READ_TOOL_IDS,
  "patch",
])

/** True when a tool alias is the name of a DAX built-in tool or one of its class aliases. */
export function isNativeToolAlias(alias: string): boolean {
  return nativeAliases.has(alias)
}

export type ExecutorKind = "builtin" | "plugin" | "mcp"

/**
 * The permission an executor is asked under.
 *
 * A built-in keeps its class: `edit`, `shell`, or its own name. So does any
 * other executor whose alias is its own. An executor that is not a built-in
 * but holds a built-in's alias is a different thing from that built-in, so it
 * is asked under its own identity. A rule written for the built-in `read` does
 * not answer for a plugin that happens to be called `read`.
 */
export function permissionForExecutor(toolId: string, kind: ExecutorKind): string {
  if (kind !== "builtin" && isNativeToolAlias(toolId)) return `${kind}:${toolId}`
  return permissionForToolId(toolId)
}
