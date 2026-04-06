import { parseGeminiSubscriptionRetryMs, shouldWaitForGeminiSubscriptionCooldown } from "./gemini-rate-limit"
import { Global } from "@/global"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "gemini-scheduler" })

const geminiSubscriptionCooldownFile = path.join(Global.Path.state, "gemini-subscription-cooldown.json")

let geminiSubscriptionCooldownUntil = 0
let inFlight = 0
let consecutiveThrottles = 0
const MAX_RETRIES = 8
const RETRY_DELAY_MS = 3000

const requestQueue: Array<{
  fn: () => Promise<Response>
  resolve: (value: Response) => void
  reject: (reason?: any) => void
  retries: number
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
      retries: 0,
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
      next.retries++
      log.warn("gemini subscription throttled", { retries: next.retries, consecutiveThrottles })

      if (next.retries >= MAX_RETRIES) {
        next.reject(err)
        consecutiveThrottles = 0
      } else {
        requestQueue.unshift(next)
        await Bun.sleep(RETRY_DELAY_MS)
      }
    } else {
      next.reject(err)
    }
  } finally {
    inFlight--
    processNext()
  }
}
