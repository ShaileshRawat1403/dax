import { describe, expect, test } from "bun:test"
import { formatSessionExitMessage } from "./exit-message"

describe("session exit message", () => {
  test("renders a compact branded snapshot when metrics are available", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_123",
      title: "Release readiness pass",
      turnCount: 3,
      tokenCount: 36673,
      generatedTokenCount: 962,
      elapsedLabel: "2m 14s",
      costLabel: "included",
    })

    expect(message).toContain("session closed")
    expect(message).toContain("Release readiness pass")
    expect(message).toContain("3 turns")
    expect(message).toContain("36,673 tokens")
    expect(message).toContain("generated 962")
    expect(message).toContain("2m 14s")
    expect(message).toContain("cost included")
    expect(message).toContain("resume: dax -s ses_123")
  })

  test("stays brief when the session has almost no metrics yet", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_123",
      turnCount: 0,
      tokenCount: 0,
      generatedTokenCount: 0,
    })

    expect(message).not.toContain("snapshot:")
    expect(message).toContain("resume: dax -s ses_123")
  })
})
