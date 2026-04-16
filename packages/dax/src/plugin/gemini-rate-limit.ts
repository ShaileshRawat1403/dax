const DEFAULT_INITIAL_DELAY_MS = 5000
const DEFAULT_MAX_DELAY_MS = 30000
const MODEL_CAPACITY_COOLDOWN_MS = 15_000

interface GoogleRpcRetryInfo {
  "@type"?: string
  retryDelay?: string | { seconds?: number; nanos?: number }
}

interface GoogleRpcErrorInfo {
  "@type"?: string
  reason?: string
  domain?: string
  metadata?: Record<string, string>
}

interface GoogleRpcQuotaViolation {
  quotaId?: string
  description?: string
}

interface GoogleRpcQuotaFailure {
  "@type"?: string
  violations?: GoogleRpcQuotaViolation[]
}

export interface QuotaContext {
  terminal: boolean
  retryDelayMs?: number
  reason?: string
}

const CLOUDCODE_DOMAINS = new Set([
  "cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
])

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
  "ERR_SSL_BAD_RECORD_MAC",
  "EPROTO",
])

export function isRetryableNetworkError(error: unknown): boolean {
  const code = getNetworkErrorCode(error)
  if (code && RETRYABLE_NETWORK_CODES.has(code)) {
    return true
  }
  return error instanceof Error && error.message.toLowerCase().includes("fetch failed")
}

function getNetworkErrorCode(error: unknown): string | undefined {
  const readCode = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") {
      return undefined
    }
    if ("code" in value && typeof (value as { code?: unknown }).code === "string") {
      return (value as { code: string }).code
    }
    return undefined
  }

  const direct = readCode(error)
  if (direct) {
    return direct
  }

  let cursor: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!cursor || typeof cursor !== "object" || !("cause" in cursor)) {
      break
    }
    cursor = (cursor as { cause?: unknown }).cause
    const code = readCode(cursor)
    if (code) {
      return code
    }
  }
  return undefined
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

export function getExponentialDelayWithJitter(attempt: number): number {
  const base = Math.min(DEFAULT_MAX_DELAY_MS, DEFAULT_INITIAL_DELAY_MS * Math.pow(2, attempt - 1))
  const jitter = base * 0.3 * (Math.random() * 2 - 1)
  return clampDelay(base + jitter)
}

function clampDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return DEFAULT_MAX_DELAY_MS
  }
  return Math.min(Math.max(0, Math.round(delayMs)), DEFAULT_MAX_DELAY_MS)
}

export function getModelCapacityCooldownMs(): number {
  return MODEL_CAPACITY_COOLDOWN_MS
}

export const DEFAULT_MAX_ATTEMPTS = 3

export async function classifyQuotaResponse(response: Response): Promise<QuotaContext | null> {
  const payload = await parseErrorBody(response)
  if (!payload) {
    return null
  }

  const details = Array.isArray(payload.details) ? payload.details : []
  const retryInfo = details.find(
    (detail): detail is GoogleRpcRetryInfo =>
      isObject(detail) && detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
  )
  const retryDelayMs =
    (retryInfo?.retryDelay ? parseRetryDelayValue(retryInfo.retryDelay) : null) ??
    parseRetryDelayFromMessage(payload.message ?? "") ??
    undefined

  const errorInfo = details.find(
    (detail): detail is GoogleRpcErrorInfo =>
      isObject(detail) && detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo",
  )

  if (errorInfo?.domain && !CLOUDCODE_DOMAINS.has(errorInfo.domain)) {
    return null
  }
  if (errorInfo?.reason === "QUOTA_EXHAUSTED") {
    return { terminal: true, retryDelayMs, reason: errorInfo.reason }
  }
  if (errorInfo?.reason === "RATE_LIMIT_EXCEEDED") {
    return { terminal: false, retryDelayMs: retryDelayMs ?? 10_000, reason: errorInfo.reason }
  }
  if (errorInfo?.reason === "MODEL_CAPACITY_EXHAUSTED") {
    return {
      terminal: false,
      retryDelayMs,
      reason: errorInfo.reason,
    }
  }

  const quotaFailure = details.find(
    (detail): detail is GoogleRpcQuotaFailure =>
      isObject(detail) && detail["@type"] === "type.googleapis.com/google.rpc.QuotaFailure",
  )
  if (quotaFailure?.violations?.length) {
    const allTexts = quotaFailure.violations
      .flatMap((violation) => [violation.quotaId ?? "", violation.description ?? ""])
      .join(" ")
      .toLowerCase()

    if (allTexts.includes("perday") || allTexts.includes("daily") || allTexts.includes("per day")) {
      return { terminal: true, retryDelayMs, reason: errorInfo?.reason }
    }
    if (allTexts.includes("perminute") || allTexts.includes("per minute")) {
      return { terminal: false, retryDelayMs: retryDelayMs ?? 60_000, reason: errorInfo?.reason }
    }
    return { terminal: false, retryDelayMs, reason: errorInfo?.reason }
  }

  const quotaLimit = errorInfo?.metadata?.quota_limit?.toLowerCase() ?? ""
  if (quotaLimit.includes("perminute") || quotaLimit.includes("per minute")) {
    return { terminal: false, retryDelayMs: retryDelayMs ?? 60_000, reason: errorInfo?.reason }
  }

  return { terminal: false, retryDelayMs, reason: errorInfo?.reason }
}

function parseRetryDelayValue(value: string | { seconds?: number; nanos?: number }): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    if (trimmed.endsWith("ms")) {
      const milliseconds = Number(trimmed.slice(0, -2))
      return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds) : null
    }
    const match = trimmed.match(/^([\d.]+)s$/)
    if (!match?.[1]) {
      return null
    }
    const seconds = Number(match[1])
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
  }

  const seconds = typeof value.seconds === "number" ? value.seconds : 0
  const nanos = typeof value.nanos === "number" ? value.nanos : 0
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    return null
  }
  const totalMs = Math.round(seconds * 1000 + nanos / 1e6)
  return totalMs > 0 ? totalMs : null
}

function parseRetryDelayFromMessage(message: string): number | null {
  const retryMatch = message.match(/Please retry in ([0-9.]+(?:ms|s))/i)
  if (retryMatch?.[1]) {
    return parseRetryDelayValue(retryMatch[1])
  }

  const afterMatch = message.match(/after\s+([0-9.]+(?:ms|s))/i)
  if (afterMatch?.[1]) {
    return parseRetryDelayValue(afterMatch[1])
  }

  return null
}

async function parseErrorBody(response: Response): Promise<{ message?: string; details?: unknown[] } | null> {
  let text = ""
  try {
    text = await response.clone().text()
  } catch {
    return null
  }
  if (!text) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  const normalized = normalizeErrorEnvelope(parsed)
  if (!normalized || !isObject(normalized.error)) {
    return null
  }

  const error = normalized.error as Record<string, unknown>
  return {
    message: typeof error.message === "string" ? error.message : undefined,
    details: Array.isArray(error.details) ? error.details : undefined,
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object"
}

function normalizeErrorEnvelope(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    const first = parsed[0]
    return isObject(first) ? first : null
  }
  return isObject(parsed) ? parsed : null
}

export async function parseRetryDelayFromBody(response: Response): Promise<number | null> {
  const payload = await parseErrorBody(response)
  if (!payload) {
    return null
  }

  const details = Array.isArray(payload.details) ? payload.details : []
  const retryInfo = details.find(
    (detail): detail is GoogleRpcRetryInfo =>
      isObject(detail) && detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
  )
  if (retryInfo?.retryDelay) {
    const delayMs = parseRetryDelayValue(retryInfo.retryDelay)
    if (delayMs !== null) {
      return delayMs
    }
  }

  if (typeof payload.message === "string") {
    return parseRetryDelayFromMessage(payload.message)
  }
  return null
}

export async function resolveRetryDelayMs(response: Response, attempt: number, quotaDelayMs?: number): Promise<number> {
  const retryAfterMsHeader = parseRetryAfterMs(response.headers.get("retry-after-ms"))
  if (retryAfterMsHeader !== null) {
    return clampDelay(retryAfterMsHeader)
  }

  const retryAfterHeader = parseRetryAfter(response.headers.get("retry-after"))
  if (retryAfterHeader !== null) {
    return clampDelay(retryAfterHeader)
  }

  if (quotaDelayMs !== undefined) {
    return clampDelay(quotaDelayMs)
  }

  const bodyDelay = await parseRetryDelayFromBody(response)
  if (bodyDelay !== null) {
    return clampDelay(bodyDelay)
  }

  return getExponentialDelayWithJitter(attempt)
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return Math.round(parsed)
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000))
  }
  const parsedDate = Date.parse(trimmed)
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now())
  }
  return null
}

export const DEFAULT_GEMINI_SUBSCRIPTION_RETRY_MS = 3_000

export function parseGeminiSubscriptionRetryMs(input: {
  retryAfter?: string | null
  retryAfterMs?: string | null
  message?: string | null
}) {
  const retryAfterMs = input.retryAfterMs ? Number.parseFloat(input.retryAfterMs) : Number.NaN
  if (!Number.isNaN(retryAfterMs) && retryAfterMs > 0) {
    return Math.ceil(retryAfterMs)
  }

  const retryAfterSeconds = input.retryAfter ? Number.parseFloat(input.retryAfter) : Number.NaN
  if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000)
  }

  const dateRetryAfter = input.retryAfter ? Date.parse(input.retryAfter) - Date.now() : Number.NaN
  if (!Number.isNaN(dateRetryAfter) && dateRetryAfter > 0) {
    return Math.ceil(dateRetryAfter)
  }

  const match = input.message?.match(/after (\d+)s/i)
  if (match) {
    return Number.parseInt(match[1] ?? "15", 10) * 1000
  }

  return DEFAULT_GEMINI_SUBSCRIPTION_RETRY_MS
}

export function shouldWaitForGeminiSubscriptionCooldown(cooldownUntil: number, now = Date.now()) {
  return cooldownUntil > now ? cooldownUntil - now : 0
}
