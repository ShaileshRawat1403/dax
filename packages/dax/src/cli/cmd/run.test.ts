import { describe, expect, test } from "bun:test"
import { buildExecutionPreview, formatSessionError } from "./run"

describe("run command framing", () => {
  test("builds an execution-intent preview for prompt-driven work", () => {
    const preview = buildExecutionPreview({
      intent: "review the release checklist and propose the next safe change",
      files: [{ filename: "README.md" }],
    })

    expect(preview.mode).toBe("intent")
    expect(preview.title).toBe("Goal")
    expect(preview.detail).toContain("review the release checklist")
    expect(preview.validation).toContain("Governed run ready")
    expect(preview.validation).toContain("1 attachment")
  })

  test("builds a workflow-command preview when command mode is used", () => {
    const preview = buildExecutionPreview({
      command: "docs",
      intent: "release-readiness",
      files: [],
    })

    expect(preview.mode).toBe("workflow_command")
    expect(preview.title).toBe("Run docs")
    expect(preview.detail).toBe("docs release-readiness")
    expect(preview.validation).toBe("Governed run ready")
  })
})

describe("session error formatting", () => {
  test("replaces the raw provider SDK string with a dax auth login pointer for auth errors", () => {
    const message = formatSessionError({
      name: "ProviderAuthError",
      data: {
        providerID: "google",
        message: "Google Generative AI API key is missing. Pass it using the 'apiKey' parameter...",
      },
    })

    expect(message).toContain("dax auth login")
    expect(message).toContain("google")
    expect(message).not.toContain("apiKey")
    expect(message).not.toContain("Generative AI API key is missing")
  })

  test("omits the provider name when auth error data has none", () => {
    const message = formatSessionError({ name: "ProviderAuthError", data: { message: "no key" } })
    expect(message).toBe("Not authenticated. Run `dax auth login` to configure a provider.")
  })

  test("falls back to the error's own message for non-auth errors", () => {
    const message = formatSessionError({
      name: "APIError",
      data: { message: "Connection reset by server" },
    })
    expect(message).toBe("Connection reset by server")
  })

  test("falls back to the error name when there is no message payload", () => {
    const message = formatSessionError({ name: "UnknownError" })
    expect(message).toBe("UnknownError")
  })
})
