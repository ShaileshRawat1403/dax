function normalizeName(value?: string | null) {
  if (!value) return undefined
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return undefined
  return trimmed
}

/**
 * The system-prompt line asking the model to use the operator's preferred name.
 *
 * A `resolvePreferredName` and `sessionPreferredNameKey` pair lived here too,
 * resolving a session override then a global default then the config username.
 * Nothing ever called them: no caller wrote a session-scoped name, so the
 * override tier was unreachable and the whole resolver was tested but dead.
 * Removed rather than finished, because a per-session preferred name is worth
 * designing fresh if it is ever wanted, not resurrecting from a stub.
 */
export function buildPreferredNamePrompt(name?: string) {
  const normalized = normalizeName(name)
  if (!normalized) return undefined
  return [
    `The user prefers to be addressed as ${normalized}.`,
    "Use the name naturally and sparingly, especially when greeting them, clarifying next steps, or summarizing important findings.",
    "Do not force the name into every paragraph.",
  ].join("\n")
}
