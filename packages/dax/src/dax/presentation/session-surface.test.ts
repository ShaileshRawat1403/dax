import { describe, expect, test } from "bun:test"
import {
  deriveAssistantInsightCard,
  deriveAuditHistory,
  deriveLiveSessionStageState,
  deriveLiveStreamStatus,
  deriveStreamFidelitySnapshot,
  parseAuditResult,
} from "./session-surface"

describe("session surface helpers", () => {
  test("parses fenced audit json safely", () => {
    const result = parseAuditResult([
      "```json",
      JSON.stringify({
        run_id: "run-1",
        timestamp: "2026-03-18T00:00:00.000Z",
        profile: "strict",
        status: "warn",
        findings: [],
        summary: {
          blocker_count: 0,
          warning_count: 2,
          info_count: 1,
        },
        next_actions: ["Fix warnings"],
        metadata: {
          trigger: "manual",
        },
      }),
      "```",
    ].join("\n"))

    expect(result?.status).toBe("warn")
    expect(result?.summary.warning_count).toBe(2)
  })

  test("derives audit history only from real audit turns", () => {
    const messages = [
      { id: "u1", role: "user", time: { created: 1 } },
      { id: "a1", role: "assistant", parentID: "u1", time: { created: 2 } },
      { id: "u2", role: "user", time: { created: 3 } },
      { id: "a2", role: "assistant", parentID: "u2", time: { created: 4 } },
    ]
    const textById: Record<string, string> = {
      u1: "/explore repo",
      a1: "not audit",
      u2: "/audit run strict",
      a2: JSON.stringify({
        run_id: "run-2",
        timestamp: "2026-03-18T00:00:00.000Z",
        profile: "strict",
        status: "pass",
        findings: [],
        summary: { blocker_count: 0, warning_count: 0, info_count: 0 },
        next_actions: [],
        metadata: { trigger: "manual" },
      }),
    }

    const history = deriveAuditHistory({
      messages,
      messageText: (id) => textById[id] ?? "",
    })

    expect(history).toHaveLength(1)
    expect(history[0]?.commandText).toBe("/audit run strict")
    expect(history[0]?.result?.status).toBe("pass")
  })

  test("derives stage state from pending tools and approvals", () => {
    expect(
      deriveLiveSessionStageState({
        permissionsCount: 1,
        questionsCount: 0,
        sessionStatusType: "busy",
        partsForMessage: () => [],
      }),
    ).toEqual({ stage: "waiting", reason: "waiting for approval" })

    expect(
      deriveLiveSessionStageState({
        permissionsCount: 0,
        questionsCount: 0,
        sessionStatusType: "busy",
        pendingID: "assistant-1",
        partsForMessage: () => [
          {
            type: "tool",
            tool: "shell",
            state: { status: "pending", input: {}, raw: "" },
          } as any,
        ],
      }),
    ).toEqual({ stage: "executing", reason: "running a command" })

    expect(
      deriveLiveSessionStageState({
        permissionsCount: 0,
        questionsCount: 0,
        sessionStatusType: "delayed",
        partsForMessage: () => [],
      }),
    ).toEqual({ stage: "thinking", reason: "waiting for provider response" })
  })

  test("derives stream status for visible reasoning and text content", () => {
    expect(
      deriveLiveStreamStatus({
        pendingID: "assistant-1",
        partsForMessage: () => [
          { type: "reasoning", text: "   " } as any,
          { type: "text", text: "   " } as any,
        ],
      }),
    ).toBe("waiting for provider response")

    expect(
      deriveLiveStreamStatus({
        pendingID: "assistant-1",
        partsForMessage: () => [{ type: "reasoning", text: "planning next step" } as any],
      }),
    ).toBe("drafting the next step")

    expect(
      deriveLiveStreamStatus({
        pendingID: "assistant-1",
        partsForMessage: () => [{ type: "text", text: "Here is the response" } as any],
      }),
    ).toBe("answer streaming")
  })

  test("derives a high-fidelity assistant insight card model", () => {
    const card = deriveAssistantInsightCard({
      asked: "Ship the release with a final verification pass.",
      doing: "Running release checks and watching the stream for regressions.",
      next: "Review blockers, then publish if the board stays clean.",
      stage: "verifying",
      streamStatus: "drafting the next step",
      durationMs: 6200,
      totalTokens: 1842,
      tokensPerSecond: 41.3,
      progress: {
        bar: "■■■□□",
        current: 3,
        total: 5,
        percent: 60,
      },
    })

    expect(card.eyebrow).toBe("Live execution board")
    expect(card.status).toBe("active")
    expect(card.rows.map((row) => row.label)).toEqual(["Mission", "Now", "Next"])
    expect(card.metrics).toEqual([
      { label: "Stage", value: "Verifying", tone: "primary" },
      { label: "Stream", value: "drafting the next step", tone: "accent" },
      { label: "Runtime", value: "6s", tone: "muted" },
      { label: "Tokens", value: "1,842", tone: "muted" },
      { label: "Pace", value: "41/s", tone: "muted" },
    ])
    expect(card.progressLine).toContain("Flow  ■■■□□")
    expect(card.progressLine).toContain("Step 3/5")
  })

  test("captures stream fidelity across tool, reasoning, text, and empty phases", () => {
    expect(
      deriveStreamFidelitySnapshot({
        pendingID: "assistant-1",
        partsForMessage: () => [
          { type: "tool", tool: "shell", state: { status: "pending", input: {}, raw: "" } } as any,
        ],
      }),
    ).toEqual({
      streamStatus: "running a command",
      hasPendingTool: true,
      hasCompletedTool: false,
      hasVisibleReasoning: false,
      hasVisibleText: false,
    })

    expect(
      deriveStreamFidelitySnapshot({
        pendingID: "assistant-1",
        partsForMessage: () => [
          { type: "tool", tool: "shell", state: { status: "completed", input: {}, raw: "" } } as any,
          { type: "reasoning", text: "Checking the final output" } as any,
        ],
      }),
    ).toEqual({
      streamStatus: "running a command complete",
      hasPendingTool: false,
      hasCompletedTool: true,
      hasVisibleReasoning: true,
      hasVisibleText: false,
    })

    expect(
      deriveStreamFidelitySnapshot({
        pendingID: "assistant-1",
        partsForMessage: () => [{ type: "text", text: "Final answer ready" } as any],
      }),
    ).toEqual({
      streamStatus: "answer streaming",
      hasPendingTool: false,
      hasCompletedTool: false,
      hasVisibleReasoning: false,
      hasVisibleText: true,
    })

    expect(
      deriveStreamFidelitySnapshot({
        pendingID: "assistant-1",
        partsForMessage: () => [
          { type: "reasoning", text: " " } as any,
          { type: "text", text: " " } as any,
        ],
      }),
    ).toEqual({
      streamStatus: "waiting for provider response",
      hasPendingTool: false,
      hasCompletedTool: false,
      hasVisibleReasoning: false,
      hasVisibleText: false,
    })
  })
})
