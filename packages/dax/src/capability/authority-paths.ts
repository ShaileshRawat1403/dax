// Dependency-free: the run event schema imports these at module load, so this
// file must not import anything that could import the event schema back.

/** Paths whose subject is a canonical native invocation. */
export const INVOCATION_PATHS = ["native_tool", "batch_leaf", "mcp_tool"] as const

/** Paths whose subject is not an invocation: an operator, prompt-time or orchestration action. */
export const ACTION_PATHS = [
  "operator_shell",
  "command_shell",
  "context_attachment",
  "template_reference",
  "mcp_resource",
  "mcp_prompt",
  "workflow",
  "worker",
  "verification_command",
] as const

export const AUTHORITY_PATHS = [...INVOCATION_PATHS, ...ACTION_PATHS] as const
export type AuthorityPath = (typeof AUTHORITY_PATHS)[number]
