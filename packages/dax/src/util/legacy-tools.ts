export type LegacyToolToggleMap = Record<string, boolean>

const EDIT_PERMISSION_ALIASES = new Set(["write", "edit", "patch", "multiedit"])

export function legacyToolTogglesToPermissionConfig(
  tools?: LegacyToolToggleMap,
): Record<string, "allow" | "deny"> {
  const permission: Record<string, "allow" | "deny"> = {}

  for (const [tool, enabled] of Object.entries(tools ?? {})) {
    const action = enabled ? "allow" : "deny"
    if (EDIT_PERMISSION_ALIASES.has(tool)) {
      permission.edit = action
      continue
    }
    permission[tool] = action
  }

  return permission
}
