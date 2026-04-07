import type { NamedError } from "@dax-ai/util/error"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"

const log = Log.create({ service: "session.retry" })

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
  // Maximum number of automatic retries before giving up and surfacing the error.
  // This prevents infinite retry loops when the provider is persistently unavailable
  // or the user has genuine quota exhaustion (not transient overload).
  export const MAX_ATTEMPTS = 8

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>, attempt: number = 0) {
    // Stop retrying after MAX_ATTEMPTS to prevent infinite loops on persistent errors
    if (attempt >= MAX_ATTEMPTS) return undefined

    if (MessageV2.APIError.isInstance(error)) {
      if (!error.data.isRetryable) return undefined

      const lane = error.data.responseHeaders?.["x-dax-rate-limit-lane"]
      const kind = error.data.responseHeaders?.["x-dax-rate-limit-kind"]
      if (lane === "gemini-subscription" && kind === "subscription-quota") {
        return "Gemini subscription lane is busy"
      }

      const status = error.data.statusCode
      // 529 = Anthropic overloaded, 503 = upstream unavailable — always retryable
      if (status === 529 || status === 503) {
        return "Provider is overloaded, retrying…"
      }
      // 429 = rate limited — retryable, surface a clear message
      if (status === 429) {
        return "Rate limited by provider, waiting for quota to recover…"
      }

      return error.data.message.includes("Overloaded") ? "Provider is overloaded, retrying…" : error.data.message
    }

    const json = iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          const parsed = JSON.parse(error.data.message)
          return parsed
        }
        return JSON.parse(error.data.message)
      } catch {
        log.debug("failed to parse error message as JSON", {
          message: error.data?.message?.substring?.(0, 200) ?? "non-string",
        })
        return undefined
      }
    })
    try {
      if (!json || typeof json !== "object") return undefined
      const code = typeof json.code === "string" ? json.code : ""

      if (json.type === "error" && json.error?.type === "too_many_requests") {
        return "Rate limited by provider, waiting for quota to recover…"
      }
      if (code.includes("exhausted") || code.includes("unavailable")) {
        return "Provider is overloaded, retrying…"
      }
      if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
        return "Rate limited by provider, waiting for quota to recover…"
      }
      // Do NOT fall through with JSON.stringify — unknown JSON errors are not retryable
      return undefined
    } catch {
      return undefined
    }
  }
}
