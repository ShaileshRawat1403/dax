import {
  classifyQuotaResponse,
  DEFAULT_MAX_ATTEMPTS,
  getExponentialDelayWithJitter,
  getModelCapacityCooldownMs,
  isRetryableNetworkError,
  isRetryableStatus,
  resolveRetryDelayMs,
} from "./gemini-rate-limit"
import { Global } from "@/global"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "gemini-scheduler" })

const geminiSubscriptionCooldownFile = path.join(Global.Path.state, "gemini-subscription-cooldown.json")

const DEBUG_ENABLED = process.env.DAX_GEMINI_DEBUG === "1"

function debugLog(message: string, meta?: Record<string, unknown>) {
  if (DEBUG_ENABLED) {
    log.info(`[GEMINI-DEBUG] ${message}`, meta)
  }
}

let geminiSubscriptionCooldownUntil = 0
let inFlight = 0
const MAX_CONCURRENCY = 4

const retryCooldownByKey = new Map<string, number>()

const requestQueue: Array<{
  fn: () => Promise<Response>
  resolve: (value: Response | null) => void
  reject: (reason?: any) => void
  attempt: number
  throttleKey: string
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
    consecutiveThrottles: retryCooldownByKey.size,
  }
}

function buildThrottleKey(url: string, projectId?: string, model?: string): string {
  return `${url}|${projectId ?? ""}|${model ?? ""}`
}

function setRetryCooldown(key: string, delayMs: number) {
  const next = Date.now() + delayMs
  const current = retryCooldownByKey.get(key) ?? 0
  retryCooldownByKey.set(key, Math.max(current, next))
  debugLog(`cooldown set ${delayMs}ms for key: ${key.slice(0, 80)}...`)
}

function getRetryCooldown(key: string): number {
  return retryCooldownByKey.get(key) ?? 0
}

export async function scheduleGeminiSubscriptionRequest<T>(
  fn: () => Promise<T>,
  options?: { projectId?: string; model?: string },
): Promise<T | null> {
  const throttleKey = buildThrottleKey("cloudcode-pa.googleapis.com", options?.projectId, options?.model)

  return new Promise<T | null>((resolve, reject) => {
    requestQueue.push({
      fn: fn as () => Promise<Response>,
      resolve: resolve as (value: Response | null) => void,
      reject,
      attempt: 1,
      throttleKey,
    })
    processNext()
  })
}

async function waitForRetryCooldown(key: string): Promise<void> {
  const until = getRetryCooldown(key)
  if (!until) return

  const remaining = until - Date.now()
  if (remaining <= 0) {
    retryCooldownByKey.delete(key)
    return
  }

  debugLog(`cooldown wait ${remaining}ms for key: ${key.slice(0, 80)}...`)
  await Bun.sleep(remaining)
  retryCooldownByKey.delete(key)
}

async function processNext() {
  if (requestQueue.length === 0) return
  if (inFlight >= MAX_CONCURRENCY) return

  const next = requestQueue.shift()
  if (!next) return

  await waitForRetryCooldown(next.throttleKey)

  inFlight++
  processNext()

  // Tracks whether the inFlight slot has already been released (e.g. on retry).
  // The finally block uses this guard to avoid double-decrementing.
  let slotReleased = false

  // Releases the inFlight slot immediately and re-queues the request for retry
  // after `delayMs`. Using setTimeout means the slot is free during the wait,
  // so other queued requests (different keys) can proceed instead of stalling.
  const scheduleRetry = (item: typeof next, delayMs: number) => {
    item.attempt++
    slotReleased = true
    inFlight--
    processNext()
    debugLog(`released slot, retry queued in ${delayMs}ms (attempt ${item.attempt}/${DEFAULT_MAX_ATTEMPTS})`, {
      delayMs,
      throttleKey: item.throttleKey.slice(0, 80),
    })
    if (delayMs > 0) {
      setTimeout(() => {
        requestQueue.unshift(item)
        processNext()
      }, delayMs)
    } else {
      requestQueue.unshift(item)
      processNext()
    }
  }

  try {
    const result = await next.fn()
    retryCooldownByKey.delete(next.throttleKey)
    debugLog(`request succeeded, cleared cooldown for key: ${next.throttleKey.slice(0, 80)}...`)
    next.resolve(result)
  } catch (err: any) {
    const status = err?.status

    if (status === 429 || isRetryableStatus(status)) {
      debugLog(`attempt ${next.attempt} got ${status}, classifying...`, {
        attempt: next.attempt,
        throttleKey: next.throttleKey.slice(0, 80),
      })

      let quotaContext: { terminal: boolean; retryDelayMs?: number; reason?: string } | null = null

      if (status === 429) {
        try {
          quotaContext = await classifyQuotaResponse(err?.response as Response)
        } catch {
          debugLog("failed to classify 429 response", { error: String(err) })
        }
      }

      if (quotaContext?.terminal) {
        debugLog(`terminal 429 (${quotaContext.reason}), giving up`, {
          reason: quotaContext.reason,
          throttleKey: next.throttleKey.slice(0, 80),
        })
        retryCooldownByKey.delete(next.throttleKey)
        next.resolve(null)
      } else if (next.attempt >= DEFAULT_MAX_ATTEMPTS) {
        debugLog(`max attempts (${DEFAULT_MAX_ATTEMPTS}) reached, giving up`, {
          attempt: next.attempt,
          throttleKey: next.throttleKey.slice(0, 80),
        })
        retryCooldownByKey.delete(next.throttleKey)
        next.resolve(null)
      } else {
        let delayMs: number

        if (quotaContext?.retryDelayMs) {
          delayMs = quotaContext.retryDelayMs
          debugLog(`using quota-provided delay: ${delayMs}ms`, { reason: quotaContext.reason })
        } else if (status === 429) {
          const headerDelay = await resolveRetryDelayMs(err?.response as Response, next.attempt)
          delayMs = headerDelay
          debugLog(`using resolved delay from headers/body: ${delayMs}ms`)
        } else {
          delayMs = getExponentialDelayWithJitter(next.attempt)
          debugLog(`using exponential backoff delay: ${delayMs}ms`, { attempt: next.attempt })
        }

        if (status === 429 && !quotaContext?.retryDelayMs) {
          setRetryCooldown(next.throttleKey, delayMs)
        }

        if (quotaContext?.reason === "MODEL_CAPACITY_EXHAUSTED" && !quotaContext.retryDelayMs) {
          const modelCapDelay = getModelCapacityCooldownMs()
          debugLog(`MODEL_CAPACITY_EXHAUSTED, setting ${modelCapDelay}ms cooldown`)
          setRetryCooldown(next.throttleKey, modelCapDelay)
        }

        scheduleRetry(next, delayMs)
      }
    } else if (isRetryableNetworkError(err)) {
      if (next.attempt >= DEFAULT_MAX_ATTEMPTS) {
        debugLog(`max attempts for network error, giving up`, { attempt: next.attempt })
        next.reject(err)
      } else {
        const delayMs = getExponentialDelayWithJitter(next.attempt)
        debugLog(`network error, retrying in ${delayMs}ms`, { attempt: next.attempt, delayMs })
        scheduleRetry(next, delayMs)
      }
    } else {
      next.reject(err)
    }
  } finally {
    if (!slotReleased) {
      inFlight--
      processNext()
    }
  }
}
