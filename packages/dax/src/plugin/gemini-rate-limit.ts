export const DEFAULT_GEMINI_SUBSCRIPTION_RETRY_MS = 15_000

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
