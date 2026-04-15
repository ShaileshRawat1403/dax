import { parseGeminiSubscriptionRetryMs, shouldWaitForGeminiSubscriptionCooldown } from "./gemini-rate-limit"
import { Global } from "@/global"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "gemini-scheduler" })

const geminiSubscriptionCooldownFile = path.join(Global.Path.state, "gemini-subscription-cooldown.json")

let geminiSubscriptionCooldownUntil = 0
let inFlight = 0
let consecutiveThrottles = 0
let currentCooldownPromise: Promise<void> | null = null
const MAX_CONCURRENCY = 4
const MAX_THROTTLE_RETRIES = 3
const THROTTLE_BACKOFF_MS = 500

const requestQueue: Array<{
  fn: () => Promise<Response>
  resolve: (value: Response | null) => void
  reject: (reason?: any) => void
  throttleRetries: number
}> = []

export async function readPersistedGeminiSubscriptionCooldown() {
  const data = await Bun.file(geminiSubscriptionCooldownFile)
    .json()
    .catch(() => undefined as undefined | { until?: number })
  return typeof data?.until === "number" ? data.until : 0
}

export async function persistGeminiSubscriptionCooldown(until: number) {
  if (until <= geminiSubscriptionCooldownUntil) return
  geminiSubscriptionCooldownUntil = until
  await Bun.write(geminiSubscriptionCooldownFile, JSON.stringify({ until }, null, 2)).catch(() => undefined)
}

export function getGeminiSubscriptionPressure() {
  return {
    inFlight,
    queueLength: requestQueue.length,
    consecutiveThrottles,
  }
}

export async function scheduleGeminiSubscriptionRequest<T>(fn: () => Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    requestQueue.push({
      fn: fn as () => Promise<Response>,
      resolve: resolve as (value: Response | null) => void,
      reject,
      throttleRetries: 0,
    })
    processNext()
  })
}

async function processNext() {
  if (requestQueue.length === 0) return
  if (inFlight >= MAX_CONCURRENCY) return

  // 1. If we are currently waiting for a global cooldown, don't start new requests
  if (currentCooldownPromise) {
    await currentCooldownPromise
    processNext()
    return
  }

  // 2. Check persisted cooldown before taking a slot
  const persistedCooldownUntil = await readPersistedGeminiSubscriptionCooldown()
  const waitMs = shouldWaitForGeminiSubscriptionCooldown(
    Math.max(geminiSubscriptionCooldownUntil, persistedCooldownUntil),
  )

  if (waitMs > 0) {
    if (!currentCooldownPromise) {
      log.info("gemini subscription waiting for cooldown", { waitMs })
      currentCooldownPromise = Bun.sleep(waitMs).then(() => {
        currentCooldownPromise = null
      })
    }
    await currentCooldownPromise
    processNext()
    return
  }

  const next = requestQueue.shift()
  if (!next) return

  inFlight++
  processNext() // Try to start next one immediately if we have capacity

  try {
    const result = await next.fn()
    consecutiveThrottles = 0
    next.resolve(result)
  } catch (err: any) {
    if (err?.status === 429) {
      consecutiveThrottles++
      const retryAfterMs = err.retryAfterMs || THROTTLE_BACKOFF_MS
      log.warn("gemini subscription throttled", {
        throttleRetries: next.throttleRetries,
        consecutiveThrottles,
        retryAfterMs,
        inFlight,
        queueLength: requestQueue.length,
      })

      if (next.throttleRetries >= MAX_THROTTLE_RETRIES) {
        log.error("gemini subscription max throttle retries exceeded", { throttleRetries: next.throttleRetries })
        next.resolve(null)
      } else {
        // Retry immediately - the cooldown was already persisted by the caller
        // This lets us quickly retry without waiting
        next.throttleRetries++
        requestQueue.unshift(next)
        processNext()
      }
    } else {
      next.reject(err)
    }
  } finally {
    inFlight--
    processNext()
  }
}
