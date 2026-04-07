import { describe, expect, test } from "bun:test"
import { SessionRetry } from "./retry"
import { MessageV2 } from "./message-v2"

describe("SessionRetry.retryable", () => {
  test("uses plain-language Gemini subscription retry copy for cloudcode quota limits", () => {
    const error = new MessageV2.APIError({
      message: "429 from cloudcode-pa",
      isRetryable: true,
      responseHeaders: {
        "x-dax-rate-limit-lane": "gemini-subscription",
        "x-dax-rate-limit-kind": "subscription-quota",
        "retry-after": "15",
      },
    }).toObject()

    expect(SessionRetry.retryable(error)).toBe("Gemini subscription lane is busy")
  })

  test("falls back to provider overload messaging for generic retryable API errors", () => {
    const error = new MessageV2.APIError({
      message: "Overloaded",
      isRetryable: true,
    }).toObject()

    expect(SessionRetry.retryable(error)).toContain("overloaded")
  })

  test("returns undefined for non-retryable errors", () => {
    const error = new MessageV2.APIError({
      message: "Invalid API key",
      statusCode: 401,
      isRetryable: false,
      responseBody: "{}",
      responseHeaders: {},
    }).toObject()

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("handles malformed JSON error message gracefully", () => {
    const error = new MessageV2.APIError({
      message: "not a json string",
      statusCode: 500,
      isRetryable: true,
      responseBody: "not valid json",
      responseHeaders: {},
    }).toObject()

    expect(SessionRetry.retryable(error)).toBeDefined()
  })

  test("returns rate-limit message for 429 errors", () => {
    const error = new MessageV2.APIError({
      message: JSON.stringify({ type: "error", error: { type: "too_many_requests" } }),
      statusCode: 429,
      isRetryable: true,
      responseBody: "{}",
      responseHeaders: {},
    }).toObject()

    const result = SessionRetry.retryable(error)
    expect(result).toBeDefined()
    expect(result).toContain("Rate limited")
  })

  test("returns rate-limit message for 429 with rate_limit error code", () => {
    const error = new MessageV2.APIError({
      message: JSON.stringify({ code: "rate_limit_exceeded" }),
      statusCode: 429,
      isRetryable: true,
      responseBody: "{}",
      responseHeaders: {},
    }).toObject()

    const result = SessionRetry.retryable(error)
    expect(result).toBeDefined()
    expect(result).toContain("Rate limited")
  })

  test("stops retrying after MAX_ATTEMPTS", () => {
    const error = new MessageV2.APIError({
      message: "Overloaded",
      isRetryable: true,
    }).toObject()

    expect(SessionRetry.retryable(error, SessionRetry.MAX_ATTEMPTS)).toBeUndefined()
    expect(SessionRetry.retryable(error, SessionRetry.MAX_ATTEMPTS - 1)).toBeDefined()
  })
})

describe("SessionRetry.delay", () => {
  test("returns initial delay for first attempt without error", () => {
    const result = SessionRetry.delay(1)
    expect(result).toBe(SessionRetry.RETRY_INITIAL_DELAY)
  })

  test("returns backoff delay for second attempt", () => {
    const result = SessionRetry.delay(2)
    expect(result).toBe(SessionRetry.RETRY_INITIAL_DELAY * Math.pow(SessionRetry.RETRY_BACKOFF_FACTOR, 1))
  })

  test("extracts delay from retry-after-ms header", () => {
    const error = new MessageV2.APIError({
      message: "Rate limited",
      statusCode: 429,
      isRetryable: true,
      responseBody: "{}",
      responseHeaders: { "retry-after-ms": "5000" },
    })
    const result = SessionRetry.delay(1, error)
    expect(result).toBe(5000)
  })

  test("extracts delay from retry-after seconds", () => {
    const error = new MessageV2.APIError({
      message: "Rate limited",
      statusCode: 429,
      isRetryable: true,
      responseBody: "{}",
      responseHeaders: { "retry-after": "5" },
    })
    const result = SessionRetry.delay(1, error)
    expect(result).toBe(5000)
  })

  test("returns backoff when retry-after is invalid", () => {
    const error = new MessageV2.APIError({
      message: "Rate limited",
      statusCode: 429,
      isRetryable: true,
      responseBody: "{}",
      responseHeaders: { "retry-after": "invalid" },
    })
    const result = SessionRetry.delay(1, error)
    expect(result).toBe(SessionRetry.RETRY_INITIAL_DELAY)
  })

  test("caps delay at max without headers", () => {
    const result = SessionRetry.delay(10)
    expect(result).toBe(SessionRetry.RETRY_MAX_DELAY_NO_HEADERS)
  })
})

describe("SessionRetry.sleep", () => {
  test("respects abort signal", async () => {
    const abort = new AbortController()
    const promise = SessionRetry.sleep(10000, abort.signal)
    abort.abort()

    await expect(promise).rejects.toThrow("Aborted")
  })

  test("completes after delay", async () => {
    const signal = new AbortController().signal
    const start = Date.now()
    await SessionRetry.sleep(100, signal)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(90)
  })
})
