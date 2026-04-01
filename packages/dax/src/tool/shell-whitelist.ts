import { VERIFICATION_SHELL_WHITELIST, type VerificationCommand } from "./constants"

export function isWhitelistedVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase()

  const forbiddenPatterns = [
    /^-c$/,
    /\s\|\s/,
    /\s&&\s/,
    /;;$/,
    /^\$\(/,
    /\bexec\b/,
    /\bsource\b/,
    /\beval\b/,
    /\bbash\b/,
    /\bsh\b/,
    /\bzsh\b/,
  ]

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(normalized)) {
      return false
    }
  }

  const parts = normalized.split(/\s+/)
  if (parts.length === 0) return false

  const executable = parts[0]

  if (parts.length === 1) {
    for (const entry of VERIFICATION_SHELL_WHITELIST) {
      if (executable === entry.executable) {
        return true
      }
    }
    return false
  }

  const args = parts.slice(1)

  for (const entry of VERIFICATION_SHELL_WHITELIST) {
    if (executable === entry.executable) {
      for (const arg of args) {
        if (arg.startsWith("-")) {
          const flag = arg.split("=")[0]
          if (entry.allowedFlags.length > 0 && !entry.allowedFlags.includes(flag)) {
            return false
          }
        } else {
          if (entry.allowedSubcommands.length > 0 && !entry.allowedSubcommands.includes(arg)) {
            return false
          }
        }
      }

      return true
    }
  }

  return false
}

export function parseCommandExecutable(command: string): { executable: string; args: string[] } | null {
  const parts = command.trim().split(/\s+/)
  if (parts.length === 0) return null

  return {
    executable: parts[0].toLowerCase(),
    args: parts.slice(1),
  }
}

export function isGenericShellEscape(command: string): boolean {
  const normalized = command.trim().toLowerCase()

  const escapePatterns = [
    { pattern: /^(node|python|python3|ruby|perl|php|lua)\s+-[ec]/, name: "inline interpreter" },
    { pattern: /^bash\s+-c/, name: "bash -c" },
    { pattern: /^sh\s+-c/, name: "sh -c" },
    { pattern: /^zsh\s+-c/, name: "zsh -c" },
    { pattern: /\$\(/, name: "command substitution" },
    { pattern: /\s\|\s/, name: "pipe" },
    { pattern: /\s&&\s/, name: "chain" },
    { pattern: />\s/, name: "redirect output" },
    { pattern: /<\s/, name: "redirect input" },
  ]

  for (const { pattern, name } of escapePatterns) {
    if (pattern.test(normalized)) {
      return true
    }
  }

  return false
}
