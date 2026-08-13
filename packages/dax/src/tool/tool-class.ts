/**
 * Canonical tool classification — the single source of truth for "what kind of
 * action does this tool perform". Consumed by the policy engine
 * (`governance/policy-engine.ts`), the Rook bridge evaluator
 * (`governance/evaluate.ts`), and the execution compiler
 * (`execution/compiler.ts`).
 *
 * Before this module, each of those carried its own hand-maintained tool-id
 * list, and they had drifted. The compiler listed a non-existent "apply" tool
 * and omitted the real "apply_patch" and "multiedit" edit tools, so a
 * read-only / analyze / audit intent silently kept edit capability. This module
 * removes that failure class by giving every consumer one list.
 *
 * Design note — why this is plain data, not a field on Tool.Info:
 * `policy-engine.ts` is deliberately kept cheap to load (see its own comment).
 * Putting the class on each tool and reading it off the registry would pull the
 * whole tool implementation graph into governance and risk an import cycle.
 * This module stays dependency-free instead, and `tool-class.test.ts` scans the
 * tool directory and fails CI if any `Tool.define(...)` id is left unclassified,
 * so the lists cannot silently drift from the tools that actually exist.
 */

/** File-editing tools. All run under the single "edit" permission EditTool asks for. */
export const EDIT_TOOL_IDS = ["edit", "write", "apply_patch", "multiedit"] as const

/** Command-executing tools. `bash`/`exec`/`run` are legacy aliases kept for parity. */
export const SHELL_TOOL_IDS = ["shell", "bash", "exec", "run"] as const

/** Observation-only tools. Safe to retain in a read-only run. */
export const READ_TOOL_IDS = ["read", "glob", "grep", "list", "lsp", "codesearch", "webfetch", "websearch"] as const

const EDIT = new Set<string>(EDIT_TOOL_IDS)
const SHELL = new Set<string>(SHELL_TOOL_IDS)
const READ = new Set<string>(READ_TOOL_IDS)

/**
 * Defensive alias: there is no "patch" tool (the real one is `apply_patch`), but
 * any action that surfaces under the name "patch" should still be gated as an
 * edit rather than slip through unclassified. Fail safe, not fail open.
 */
const EDIT_ALIASES = new Set<string>(["patch"])

/** True for the file-editing tools (edit, write, apply_patch, multiedit). */
export function isEditTool(toolId: string): boolean {
  return EDIT.has(toolId) || EDIT_ALIASES.has(toolId)
}

/** True when the tool can mutate the workspace or run commands. */
export function isMutatingTool(toolId: string): boolean {
  return isEditTool(toolId) || SHELL.has(toolId)
}

/** True when the tool only observes, and is safe to keep in a read-only run. */
export function isReadTool(toolId: string): boolean {
  return READ.has(toolId)
}

/** The permission class a tool operates under: "edit", "shell", or its own id. */
export function permissionForToolId(toolId: string): string {
  if (isEditTool(toolId)) return "edit"
  if (SHELL.has(toolId)) return "shell"
  return toolId
}
