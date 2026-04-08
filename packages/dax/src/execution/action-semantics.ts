import { BashArity } from "@/governance/arity"
import {
  isGenericShellEscape,
  isWhitelistedVerificationCommand,
  parseCommandExecutable,
} from "@/tool/shell-whitelist"
import type { RuntimeActionClass } from "./runtime-guard"

type GuardRequest = {
  permission: string
  patterns: string[]
  metadata: Record<string, any>
}

export type GovernanceActionFamily = "shell" | "file_write" | "file_edit" | "external_directory" | "unknown"
export type GovernanceIntent = "verify" | "mutate" | "inspect" | "commit" | "publish" | "unknown"
export type TypedSource = "explicit" | "derived" | "heuristic_fallback"

export type RuntimeActionSemantics = {
  actionClass: RuntimeActionClass
  actionFamily: GovernanceActionFamily
  governanceIntent: GovernanceIntent
  pathTargets: string[]
  commandSummary?: string
  typedSource: TypedSource
}

const VERIFY_PREFIXES = ["pytest", "vitest", "jest", "cargo test", "go test", "bun test", "npm test", "pnpm test"]
const PUBLISH_PREFIXES = [
  "git push",
  "gh pr create",
  "gh release create",
  "npm publish",
  "pnpm publish",
  "cargo publish",
]
const COMMIT_PREFIXES = ["git commit", "git merge", "git rebase", "git cherry-pick"]
const MUTATING_PREFIXES = [
  "rm",
  "mv",
  "cp",
  "mkdir",
  "touch",
  "git add",
  "git restore",
  "git reset",
  "sed -i",
  "perl -pi",
  "tee",
]

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false
      else current += char
      continue
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false
      } else if (char === "\\" && i + 1 < command.length) {
        current += command[i + 1]
        i++
      } else {
        current += char
      }
      continue
    }

    if (char === "'") {
      inSingleQuote = true
    } else if (char === '"') {
      inDoubleQuote = true
    } else if (char === "\\" && i + 1 < command.length) {
      current += command[i + 1]
      i++
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

function toIntent(actionClass: RuntimeActionClass): GovernanceIntent {
  switch (actionClass) {
    case "verify":
      return "verify"
    case "mutate":
      return "mutate"
    case "commit":
      return "commit"
    case "publish":
      return "publish"
    default:
      return "inspect"
  }
}

function heuristicShellClass(commandText: string): RuntimeActionClass {
  const tokens = tokenizeCommand(commandText)
  const prefix = BashArity.prefix(tokens).join(" ")

  if (VERIFY_PREFIXES.some((item) => prefix.startsWith(item) || commandText.includes(item))) return "verify"
  if (PUBLISH_PREFIXES.some((item) => prefix.startsWith(item) || commandText.includes(item))) return "publish"
  if (COMMIT_PREFIXES.some((item) => prefix.startsWith(item) || commandText.includes(item))) return "commit"
  if (MUTATING_PREFIXES.some((item) => prefix.startsWith(item) || commandText.includes(item))) return "mutate"
  if (/>=?/.test(commandText)) return "mutate"
  return "analyze"
}

function buildHeuristicFallback(input: { toolID?: string; req: GuardRequest }, commandText?: string): RuntimeActionSemantics {
  if (input.req.permission === "edit") {
    return {
      actionClass: "mutate",
      actionFamily: input.toolID === "write" ? "file_write" : "file_edit",
      governanceIntent: "mutate",
      pathTargets: input.req.patterns,
      typedSource: "heuristic_fallback",
    }
  }

  if (input.req.permission === "external_directory") {
    return {
      actionClass: "analyze",
      actionFamily: "external_directory",
      governanceIntent: "inspect",
      pathTargets: input.req.patterns,
      typedSource: "heuristic_fallback",
    }
  }

  const actionClass = input.req.permission === "shell" ? heuristicShellClass(commandText ?? "") : "analyze"
  return {
    actionClass,
    actionFamily: input.req.permission === "shell" ? "shell" : "unknown",
    governanceIntent: toIntent(actionClass),
    pathTargets: input.req.patterns,
    commandSummary: commandText || undefined,
    typedSource: "heuristic_fallback",
  }
}

function hasCompoundShellOperators(commandText: string) {
  return /\s(?:&&|\|\||\|)\s|;|`|\$\(/.test(commandText) || isGenericShellEscape(commandText)
}

export function deriveRuntimeActionSemantics(input: { toolID?: string; req: GuardRequest }): RuntimeActionSemantics {
  if (input.req.permission === "edit") {
    return {
      actionClass: "mutate",
      actionFamily: input.toolID === "write" ? "file_write" : "file_edit",
      governanceIntent: "mutate",
      pathTargets: input.req.patterns,
      typedSource: "explicit",
    }
  }

  if (input.req.permission === "external_directory") {
    return {
      actionClass: "analyze",
      actionFamily: "external_directory",
      governanceIntent: "inspect",
      pathTargets: input.req.patterns,
      typedSource: "explicit",
    }
  }

  if (input.req.permission !== "shell") {
    return buildHeuristicFallback(input)
  }

  const commandText = input.req.patterns.join(" && ").trim()
  if (!commandText) return buildHeuristicFallback(input, commandText)
  if (input.req.patterns.length !== 1 || hasCompoundShellOperators(commandText)) {
    return buildHeuristicFallback(input, commandText)
  }

  const parsed = parseCommandExecutable(commandText)
  if (!parsed) return buildHeuristicFallback(input, commandText)

  const prefix = BashArity.prefix([parsed.executable, ...parsed.args]).join(" ")
  const commandSummary = prefix || parsed.executable

  if (isWhitelistedVerificationCommand(commandText) || VERIFY_PREFIXES.some((item) => prefix.startsWith(item))) {
    return {
      actionClass: "verify",
      actionFamily: "shell",
      governanceIntent: "verify",
      pathTargets: input.req.patterns,
      commandSummary,
      typedSource: "derived",
    }
  }

  if (/>>{0,1}/.test(commandText) || MUTATING_PREFIXES.some((item) => prefix.startsWith(item))) {
    return {
      actionClass: "mutate",
      actionFamily: "shell",
      governanceIntent: "mutate",
      pathTargets: input.req.patterns,
      commandSummary,
      typedSource: "derived",
    }
  }

  return buildHeuristicFallback(input, commandText)
}
