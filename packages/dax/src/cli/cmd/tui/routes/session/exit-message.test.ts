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

  test("renders Workspace Changes section when files were modified", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_456",
      title: "Refactor auth middleware",
      turnCount: 5,
      tokenCount: 12000,
      generatedTokenCount: 4000,
      summary: {
        files_changed: [
          "src/auth/middleware.ts",
          "src/auth/token.ts",
          "tests/auth.test.ts",
        ],
      },
    })

    expect(message).toContain("Workspace Changes")
    expect(message).toContain("src/auth/middleware.ts")
    expect(message).toContain("src/auth/token.ts")
    expect(message).toContain("tests/auth.test.ts")
  })

  test("omits Workspace Changes section when files_changed is empty", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_789",
      title: "Explored the codebase",
      turnCount: 2,
      tokenCount: 5000,
      generatedTokenCount: 1200,
      summary: {
        files_changed: [],
      },
    })

    expect(message).not.toContain("Workspace Changes")
  })

  test("title appears exactly once — not duplicated as Achievement", () => {
    const title = "Fix authentication bug"
    const message = formatSessionExitMessage({
      sessionID: "ses_999",
      title,
      turnCount: 3,
      tokenCount: 8000,
      generatedTokenCount: 2000,
      // No summary.achievement provided — worker no longer sets it to session.title
    })

    // Title appears in the header area
    expect(message).toContain(title)
    // Achievement section must NOT appear (achievement is undefined)
    expect(message).not.toContain("Achievement")
    // Title must not be duplicated
    const occurrences = message.split(title).length - 1
    expect(occurrences).toBe(1)
  })

  test("renders Achievement section only when explicitly set to a meaningful value", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_101",
      title: "Reduce bundle size",
      turnCount: 8,
      tokenCount: 25000,
      generatedTokenCount: 9000,
      summary: {
        achievement: "Reduced main bundle by 34% through tree-shaking and code splitting",
        files_changed: ["vite.config.ts", "src/index.ts"],
      },
    })

    expect(message).toContain("Achievement")
    expect(message).toContain("Reduced main bundle by 34%")
  })

  test("single-turn session renders correctly with a resume hint", () => {
    const message = formatSessionExitMessage({
      sessionID: "ses_single",
      title: "Quick fix",
      turnCount: 1,
      tokenCount: 800,
      generatedTokenCount: 200,
    })

    // Correct singular form
    expect(message).toContain("1 turn")
    expect(message).not.toContain("1 turns")
    expect(message).toContain("resume: dax -s ses_single")
  })
})
