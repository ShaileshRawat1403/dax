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

    expect(SessionRetry.retryable(error)).toBe("Provider is overloaded")
  })
})
