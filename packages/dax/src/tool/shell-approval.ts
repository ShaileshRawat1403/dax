const DIRECT_PATH_COMMANDS = new Set(["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"])
const OPAQUE_PATH_COMMANDS = new Set([
  "sed",
  "tee",
  "awk",
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "patch",
  "git",
  "sh",
  "bash",
  "zsh",
  "env",
])

export function stripOuterQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith("`") && value.endsWith("`"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function isPathLikeArg(arg: string) {
  const value = stripOuterQuotes(arg)
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.includes("/") ||
    value.startsWith("file://")
  )
}

export function shellHasOpaquePathEffects(commandText: string, command: string[]) {
  if (command.length === 0) return false
  const name = command[0]
  if (OPAQUE_PATH_COMMANDS.has(name)) return true
  if (commandText.includes(">>") || commandText.includes(">") || commandText.includes("<<")) return true
  if (name === "tee") return true
  if (
    (name === "python" || name === "python3" || name === "node" || name === "ruby" || name === "perl") &&
    command.some((arg) => arg === "-c" || arg === "-e")
  ) {
    return true
  }
  if ((name === "sh" || name === "bash" || name === "zsh") && command.some((arg) => arg === "-c")) return true
  return false
}

export function shellPathCandidates(commandText: string, command: string[]) {
  const candidates = new Set<string>()
  const directPathMode = command.length > 0 && DIRECT_PATH_COMMANDS.has(command[0])
  const opaquePathMode = shellHasOpaquePathEffects(commandText, command)

  for (const arg of command.slice(1)) {
    if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
    if (directPathMode || opaquePathMode || isPathLikeArg(arg)) {
      const normalized = stripOuterQuotes(arg)
      if (normalized) candidates.add(normalized)
    }
  }

  const redirectPattern = /(?:^|[;&|]\s*|\s)(?:\d*>>?|\d*<<?)\s*(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/g
  for (const match of commandText.matchAll(redirectPattern)) {
    const value = match[1] || match[2] || match[3]
    if (value) candidates.add(value)
  }

  return Array.from(candidates)
}
