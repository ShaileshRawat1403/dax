import type { CheckResult } from "@/sdlc/check-types"

const SENSITIVE_ENV_NAME = /(api[_-]?key|token|secret|password|authorization|credential)/i
const STRUCTURED_SECRET =
  /((?:api[_-]?key|token|secret|password|authorization|credential)["']?\s*[:=]\s*["']?)([^\s"',;]+)/gi
const BEARER_SECRET = /(bearer\s+)([a-z0-9._~+/-]+=*)/gi
const COMMON_SECRET = /\b(sk-(?:ant-|proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|glpat-[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,})\b/gi

function knownSecretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length)
}

/** Redact durable verification previews while leaving the raw-result digest authoritative. */
export function redactEvidenceText(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = value
  for (const secret of knownSecretValues(env)) redacted = redacted.replaceAll(secret, "[REDACTED]")
  return redacted
    .replace(BEARER_SECRET, "$1[REDACTED]")
    .replace(STRUCTURED_SECRET, "$1[REDACTED]")
    .replace(COMMON_SECRET, "[REDACTED]")
}

export function redactCheckResult(result: CheckResult, env?: NodeJS.ProcessEnv): CheckResult {
  return {
    ...result,
    stdoutPreview: redactEvidenceText(result.stdoutPreview, env),
    stderrPreview: redactEvidenceText(result.stderrPreview, env),
  }
}

/**
 * Redact every string inside a structure.
 *
 * Redacting serialized JSON instead does not work: inside a JSON string the
 * quotes are escaped, so `\"api_key\": \"...\"` no longer matches the
 * structured-secret pattern and the value survives. Walk the values, where the
 * text is unescaped and the patterns apply.
 */
export function redactDeep<T>(value: T, env?: NodeJS.ProcessEnv): T {
  if (typeof value === "string") return redactEvidenceText(value, env) as unknown as T
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, env)) as unknown as T
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDeep(item, env)]),
    ) as unknown as T
  }
  return value
}
