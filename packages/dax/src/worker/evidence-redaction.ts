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
