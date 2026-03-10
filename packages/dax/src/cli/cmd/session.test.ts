import { describe, expect, test } from "bun:test"
import { buildSessionTimelineRows, formatSessionTimeline, type SessionTimelineRow } from "./session"

describe("session timeline helpers", () => {
  test("builds meaningful operator-facing timeline rows from session state", () => {
    const rows = buildSessionTimelineRows({
      session: {
        id: "session_123",
        slug: "repo-audit",
        projectID: "project_1",
        directory: "/repo",
        title: "Repo audit",
        version: "1.0.0",
        time: {
          created: 1_000,
          updated: 9_000,
        },
      } as any,
      messages: [
        {
          info: {
            id: "message_1",
            role: "assistant",
            sessionID: "session_123",
            parentID: "message_user",
            providerID: "openai",
            modelID: "gpt-5",
            mode: "default",
            agent: "default",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 2_000 },
          },
          parts: [],
        },
      ] as any,
      approvals: [
        {
          id: "permission_1",
          createdAt: 3_000,
          sessionID: "session_123",
          permission: "bash",
          patterns: ["npm test"],
        },
      ],
      artifacts: [
        {
          id: "artifact_1",
          kind: "attachment",
          session_id: "session_123",
          label: "scan_report.json",
          source: "bash attachment",
          created_at: 5_000,
          reference: "scan_report.json",
        },
      ],
      ledgerEvents: [
        {
          id: "event_1",
          project_id: "project_1",
          session_id: "session_123",
          message_id: null,
          event_type: "override",
          payload: {
            permission: "bash",
            reply: "once",
          },
          policy_hash: null,
          contract_hash: null,
          pm_rev: 1,
          created_at: 4_000,
        },
        {
          id: "event_2",
          project_id: "project_1",
          session_id: "session_123",
          message_id: null,
          event_type: "audit",
          payload: {
            run_id: "audit_1",
            status: "warn",
            blockers: 0,
            warnings: 2,
          },
          policy_hash: null,
          contract_hash: null,
          pm_rev: 1,
          created_at: 6_000,
        },
      ] as any,
      planGeneratedAt: 1_500,
      planReference: ".dax/plans/1-repo-audit.md",
    })

    expect(rows.map((row) => row.type)).toEqual([
      "session_created",
      "plan_generated",
      "execution_started",
      "approval_requested",
      "approval_resolved",
      "artifact_produced",
      "audit_finding_recorded",
      "trust_posture_changed",
    ])
    expect(rows[1]?.reference).toContain(".dax/plans")
    expect(rows[6]?.summary).toContain("2 warnings")
    expect(rows[7]?.summary).toContain("review_needed")
  })

  test("formats a readable structured timeline for operators", () => {
    const rendered = formatSessionTimeline([
      {
        id: "session:1",
        type: "session_created",
        session_id: "session_123",
        timestamp: 1_000,
        source: "session",
        summary: "Session created: Repo audit",
        state_effect: "lifecycle created",
      },
      {
        id: "trust:1",
        type: "trust_posture_changed",
        session_id: "session_123",
        timestamp: 2_000,
        source: "audit",
        summary: "Trust posture changed to review_needed",
        reference: "audit_1",
      },
    ] satisfies SessionTimelineRow[])

    expect(rendered).toContain("Session created")
    expect(rendered).toContain("Trust posture changed")
    expect(rendered).toContain("Effect: lifecycle created")
    expect(rendered).toContain("Reference: audit_1")
  })
})
