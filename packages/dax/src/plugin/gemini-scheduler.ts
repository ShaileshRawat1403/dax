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
  fn: () => Promise<any>
  resolve: (value: any) => void
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
    requestQueue.push({ fn, resolve, reject })
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

    // Add a small jittered pacing between requests to prevent burst storm
    // High throttle count increases pacing
    const pacing = 200 + Math.random() * 300 + consecutiveThrottles * 500
    await Bun.sleep(pacing)

    const result = await next.fn()
    consecutiveThrottles = 0 // Reset on success
    next.resolve(result)
  } catch (err: any) {
    if (err?.status === 429) {
      consecutiveThrottles++
      log.warn("gemini subscription throttled", { consecutiveThrottles })
    }
    next.reject(err)
  } finally {
    inFlight--
    // Schedule next
    processNext()
  }
}
