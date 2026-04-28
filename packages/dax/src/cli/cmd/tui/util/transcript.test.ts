import { describe, expect, test } from "bun:test"
import { formatTranscript } from "./transcript"

describe("formatTranscript", () => {
  test("renders session overview and tool summaries as markdown tables", () => {
    const transcript = formatTranscript(
      {
        id: "ses_123",
        title: "Release Readiness",
        time: {
          created: Date.parse("2026-04-28T10:00:00Z"),
          updated: Date.parse("2026-04-28T10:05:00Z"),
        },
      },
      [
        {
          info: {
            id: "msg_user",
            role: "user",
            sessionID: "ses_123",
            time: { created: Date.parse("2026-04-28T10:00:10Z") },
          } as any,
          parts: [{ type: "text", text: "Check release readiness." } as any],
        },
        {
          info: {
            id: "msg_assistant",
            role: "assistant",
            sessionID: "ses_123",
            agent: "dax",
            modelID: "gpt-5",
            time: {
              created: Date.parse("2026-04-28T10:00:20Z"),
              completed: Date.parse("2026-04-28T10:00:25Z"),
            },
          } as any,
          parts: [
            {
              type: "tool",
              tool: "shell",
              state: {
                status: "completed",
                input: { command: "bun test" },
                output: "12 passed",
                time: {
                  start: Date.parse("2026-04-28T10:00:21Z"),
                  end: Date.parse("2026-04-28T10:00:23Z"),
                },
              },
            } as any,
          ],
        },
      ],
      {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
      },
    )

    expect(transcript).toContain("## Session Overview")
    expect(transcript).toContain("| Field | Value |")
    expect(transcript).toContain("## Conversation Summary")
    expect(transcript).toContain("| Metric | Value |")
    expect(transcript).toContain("| Tool | Status | Duration | Summary |")
    expect(transcript).toContain("| shell | completed | 2s | 12 passed |")
  })
})
