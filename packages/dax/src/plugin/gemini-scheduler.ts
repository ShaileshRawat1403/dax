import { parseGeminiSubscriptionRetryMs, shouldWaitForGeminiSubscriptionCooldown } from "./gemini-rate-limit"
import { Global } from "@/global"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "gemini-scheduler" })

const geminiSubscriptionCooldownFile = path.join(Global.Path.state, "gemini-subscription-cooldown.json")

let geminiSubscriptionCooldownUntil = 0
let inFlight = 0
let consecutiveThrottles = 0
const requestQueue: Array<{
  fn: () => Promise<Response>
  resolve: (value: Response) => void
  reject: (reason?: any) => void
}> = []

export async function readPersistedGeminiSubscriptionCooldown() {
  const data = await Bun.file(geminiSubscriptionCooldownFile)
    .json()
    .catch(() => undefined as undefined | { until?: number })
  return typeof data?.until === "number" ? data.until : 0
}

export async function persistGeminiSubscriptionCooldown(until: number) {
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

export async function scheduleGeminiSubscriptionRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push({
      fn: fn as () => Promise<Response>,
      resolve: resolve as (value: Response) => void,
      reject,
    })
    if (inFlight === 0) {
      processNext()
    } else {
      log.debug("gemini subscription request queued", { queueLength: requestQueue.length })
    }
  })
}

async function processNext() {
  if (requestQueue.length === 0) return
  if (inFlight > 0) return

  const next = requestQueue.shift()
  if (!next) return

  inFlight++

  try {
    const persistedCooldownUntil = await readPersistedGeminiSubscriptionCooldown()
    const effectiveCooldownUntil = Math.max(geminiSubscriptionCooldownUntil, persistedCooldownUntil)
    const waitMs = shouldWaitForGeminiSubscriptionCooldown(effectiveCooldownUntil)
    if (waitMs > 0) {
      log.info("gemini subscription waiting for cooldown", { waitMs })
      await Bun.sleep(waitMs)
    }

    const result = await next.fn()
    consecutiveThrottles = 0
    next.resolve(result)
  } catch (err: any) {
    if (err?.status === 429) {
      consecutiveThrottles++
      const retryMs = err.retryAfterMs ?? 15000
      log.warn("gemini subscription throttled", { consecutiveThrottles, retryAfterMs: retryMs })
      // Reset cooldown so next request starts fresh
      geminiSubscriptionCooldownUntil = 0
      await Bun.file(geminiSubscriptionCooldownFile)
        .delete()
        .catch(() => {})
      // Re-queue for retry after the server-specified delay
      requestQueue.unshift(next)
      // Wait the cooldown before processing next
      await Bun.sleep(retryMs)
    } else {
      next.reject(err)
    }
  } finally {
    inFlight--
    processNext()
  }
}
