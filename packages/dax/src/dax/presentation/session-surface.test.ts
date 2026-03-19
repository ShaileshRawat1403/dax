import { describe, expect, test } from "bun:test"
import { deriveAuditHistory, deriveLiveSessionStageState, parseAuditResult } from "./session-surface"

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
    ).toEqual({ stage: "executing", reason: "shell in progress" })
  })
})
