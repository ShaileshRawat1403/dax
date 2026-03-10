import { describe, expect, test } from "bun:test"
import {
  buildSessionTimelineRows,
  collectSessionInspectSummary,
  collectSessionShowSummary,
  deriveSessionStage,
  deriveStagesReached,
  deriveSessionHistoryOutcome,
  formatSessionInspectSummary,
  formatSessionShowSummary,
  formatSessionTable,
  formatSessionTimeline,
  toSessionHistoryRow,
  type SessionTimelineRow,
} from "./session"
import { bootstrap } from "../bootstrap"
import path from "path"

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
            id: "message_0",
            role: "user",
            sessionID: "session_123",
            providerID: "openai",
            modelID: "gpt-5",
            mode: "default",
            agent: "default",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1_800 },
          },
          parts: [],
        },
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
        {
          info: {
            id: "message_2",
            role: "user",
            sessionID: "session_123",
            providerID: "openai",
            modelID: "gpt-5",
            mode: "default",
            agent: "default",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 8_000 },
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
        {
          id: "artifact_2",
          kind: "attachment",
          session_id: "session_123",
          label: "dependency_summary.md",
          source: "bash attachment",
          created_at: 5_030,
          reference: "/tmp/tool-output/dependency_summary.md",
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
    expect(rows[5]?.summary).toContain("Artifacts produced (2)")
    expect(rows[5]?.reference).toContain("scan_report.json")
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

  test("rewrites implementation-shaped artifact and approval references into operator language", () => {
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
          updated: 3_000,
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
      approvals: [],
      artifacts: [
        {
          id: "artifact_1",
          kind: "attachment",
          session_id: "session_123",
          label: "Automatically fix linting errors",
          source: "bash attachment",
          created_at: 2_500,
          reference: "../../../../../ananyalayek/.local/share/dax/tool-output/tool_cd2614ecd001KKo1cuf3SloL0n",
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
          created_at: 2_200,
        },
      ] as any,
    })

    expect(rows.find((row) => row.type === "approval_resolved")?.summary).toContain("Approval granted for command execution")
    expect(rows.find((row) => row.type === "artifact_produced")?.reference).toContain("tool_cd2614ecd001KKo1cuf3SloL0n")
  })

  test("adds execution completed when the session shows completed progression without pending approvals", () => {
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
          updated: 5_000,
        },
      } as any,
      messages: [
        {
          info: {
            id: "message_0",
            role: "user",
            sessionID: "session_123",
            providerID: "openai",
            modelID: "gpt-5",
            mode: "default",
            agent: "default",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1_100 },
          },
          parts: [],
        },
        {
          info: {
            id: "message_1",
            role: "assistant",
            sessionID: "session_123",
            parentID: "message_0",
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
        {
          info: {
            id: "message_2",
            role: "user",
            sessionID: "session_123",
            providerID: "openai",
            modelID: "gpt-5",
            mode: "default",
            agent: "default",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 4_000 },
          },
          parts: [],
        },
      ] as any,
      approvals: [],
      artifacts: [],
      ledgerEvents: [],
    })

    expect(rows.find((row) => row.type === "execution_completed")?.summary).toContain("Execution completed")
  })

  test("derives session history rows with outcome, trust posture, and verification result", () => {
    const row = toSessionHistoryRow({
      session: {
        id: "session_history_1",
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
      timeline: [
        {
          id: "execution:done",
          type: "execution_completed",
          session_id: "session_history_1",
          timestamp: 9_000,
          source: "execution",
          summary: "Execution completed",
        },
      ],
      verification: {
        type: "session_verification",
        project_id: "project_1",
        session_id: "session_history_1",
        verification_result: "verification_passed",
        trust_posture: "verified",
        checks: [],
        blocking_factors: [],
        degrading_factors: [],
      },
    })

    expect(row.outcome).toBe("completed")
    expect(row.trust_posture).toBe("verified")
    expect(row.verification_result).toBe("verification_passed")
  })

  test("marks pending approval sessions as blocked in history view", () => {
    const outcome = deriveSessionHistoryOutcome(
      {
        id: "session_blocked",
        slug: "repo-audit",
        projectID: "project_1",
        directory: "/repo",
        title: "Repo audit",
        version: "1.0.0",
        time: {
          created: 1_000,
          updated: 2_000,
        },
      } as any,
      [
        {
          id: "approval:1",
          type: "approval_requested",
          session_id: "session_blocked",
          timestamp: 1_500,
          source: "governance",
          summary: "Approval requested",
        },
      ],
    )

    expect(outcome).toBe("blocked")
  })

  test("formats session history rows as a compact record browser", () => {
    const rendered = formatSessionTable([
      {
        id: "session_123",
        title: "Repo audit",
        created: 1_000,
        updated: 2_000,
        outcome: "completed",
        trust_posture: "verified",
        verification_result: "verification_passed",
      },
    ])

    expect(rendered).toContain("Outcome")
    expect(rendered).toContain("Trust")
    expect(rendered).toContain("Verification")
    expect(rendered).toContain("Completed")
    expect(rendered).toContain("Verified")
    expect(rendered).toContain("Passed")
  })

  test("formats a concise durable session summary", () => {
    const rendered = formatSessionShowSummary({
      id: "session_show_1",
      title: "Repo audit",
      project_id: "project_1",
      directory: "/repo",
      created: 1_000,
      updated: 2_000,
      outcome: "completed",
      trust_posture: "verified",
      verification_result: "verification_passed",
      stage: "verification",
      artifact_count: 2,
      approval_count: 0,
      override_count: 1,
      timeline_count: 6,
      audit_posture: "review_needed",
      latest_activity_at: 2_000,
    })

    expect(rendered).toContain("Session: session_show_1")
    expect(rendered).toContain("Outcome: Completed")
    expect(rendered).toContain("Stage: Verification")
    expect(rendered).toContain("Trust posture: Verified")
    expect(rendered).toContain("Verification: Passed")
    expect(rendered).toContain("Audit posture: Review needed")
    expect(rendered).toContain("Timeline events: 6")
  })

  test("derives a review stage when governance or audit review is still active", () => {
    expect(
      deriveSessionStage({
        timeline: [
          {
            id: "timeline_1",
            type: "execution_completed",
            session_id: "session_stage_1",
            timestamp: 2_000,
            source: "execution",
            summary: "Execution completed",
          },
        ],
        approval_count: 1,
        audit_posture: "review_needed",
        verification_result: "verification_incomplete",
      }),
    ).toBe("review")
  })

  test("derives planning and implementation stages from timeline progression", () => {
    expect(
      deriveSessionStage({
        timeline: [
          {
            id: "timeline_plan",
            type: "plan_generated",
            session_id: "session_stage_2",
            timestamp: 1_000,
            source: "planning",
            summary: "Plan generated",
          },
        ],
        approval_count: 0,
        audit_posture: "clear",
        verification_result: "verification_incomplete",
      }),
    ).toBe("planning")

    expect(
      deriveSessionStage({
        timeline: [
          {
            id: "timeline_impl",
            type: "artifact_produced",
            session_id: "session_stage_3",
            timestamp: 2_000,
            source: "artifact",
            summary: "Artifacts produced (2)",
          },
        ],
        approval_count: 0,
        audit_posture: "clear",
        verification_result: "verification_incomplete",
      }),
    ).toBe("implementation")
  })

  test("derives ordered stages reached from timeline progression", () => {
    expect(
      deriveStagesReached(
        [
          {
            id: "timeline_created",
            type: "session_created",
            session_id: "session_stage_path",
            timestamp: 1_000,
            source: "session",
            summary: "Session created",
          },
          {
            id: "timeline_plan",
            type: "plan_generated",
            session_id: "session_stage_path",
            timestamp: 2_000,
            source: "planning",
            summary: "Plan generated",
          },
          {
            id: "timeline_impl",
            type: "artifact_produced",
            session_id: "session_stage_path",
            timestamp: 3_000,
            source: "artifact",
            summary: "Artifacts produced (2)",
          },
          {
            id: "timeline_review",
            type: "trust_posture_changed",
            session_id: "session_stage_path",
            timestamp: 4_000,
            source: "audit",
            summary: "Trust posture updated",
          },
        ],
        "review",
      ),
    ).toEqual(["discovery", "planning", "implementation", "review"])
  })

  test(
    "collects a durable session summary from canonical session surfaces",
    async () => {
      const repoRoot = path.resolve(import.meta.dir, "../../../..")
      const summary = await bootstrap(repoRoot, () => collectSessionShowSummary("ses_32947d739ffeVp11tIEucq7Omg"))

      expect(summary.id).toBe("ses_32947d739ffeVp11tIEucq7Omg")
      expect(typeof summary.title).toBe("string")
      expect(typeof summary.timeline_count).toBe("number")
      expect(typeof summary.artifact_count).toBe("number")
      expect(typeof summary.approval_count).toBe("number")
      expect(typeof summary.override_count).toBe("number")
      expect(["active", "blocked", "completed", "archived"]).toContain(summary.outcome)
      expect(["discovery", "planning", "implementation", "verification", "review", "release_preparation"]).toContain(
        summary.stage,
      )
      expect(["review_needed", "policy_clean", "verified"]).toContain(summary.trust_posture)
      expect(["verification_passed", "verification_failed", "verification_incomplete", "verification_degraded"]).toContain(
        summary.verification_result,
      )
      expect(["clear", "review_needed", "blocked"]).toContain(summary.audit_posture)
    },
    40000,
  )

  test("formats a deep inspection surface for a durable session record", () => {
    const rendered = formatSessionInspectSummary({
      type: "session_inspect",
      summary: {
        id: "session_inspect_1",
        title: "Repo audit",
        project_id: "project_1",
        directory: "/repo",
        created: 1_000,
        updated: 2_000,
        outcome: "completed",
        trust_posture: "verified",
        verification_result: "verification_passed",
        stage: "verification",
        artifact_count: 1,
        approval_count: 0,
        override_count: 0,
        timeline_count: 2,
        audit_posture: "clear",
        latest_activity_at: 2_000,
      },
      stages_reached: ["planning", "implementation", "verification"],
      timeline: [
        {
          id: "timeline_1",
          type: "execution_completed",
          session_id: "session_inspect_1",
          timestamp: 2_000,
          source: "execution",
          summary: "Execution completed",
          state_effect: "lifecycle completed",
        },
      ],
      artifacts: [
        {
          id: "artifact_1",
          kind: "attachment",
          session_id: "session_inspect_1",
          label: "scan_report.json",
          source: "bash attachment",
          created_at: 2_000,
        },
      ],
      audit: {
        type: "audit_summary",
        project_id: "project_1",
        session_id: "session_inspect_1",
        posture: "clear",
        approvals: {
          requested: 0,
          overrides: 0,
        },
        evidence: {
          diff_present: true,
          artifacts_present: true,
          sessions_with_diffs: 1,
          artifact_count: 1,
        },
        findings: {
          status: "pass",
          blocker_count: 0,
          warning_count: 0,
          info_count: 0,
        },
        next_actions: [],
      },
      verification: {
        type: "session_verification",
        project_id: "project_1",
        session_id: "session_inspect_1",
        verification_result: "verification_passed",
        trust_posture: "verified",
        checks: [
          {
            id: "approvals",
            label: "Approvals",
            status: "pass",
            summary: "No pending approvals remain.",
          },
        ],
        blocking_factors: [],
        degrading_factors: [],
      },
    })

    expect(rendered).toContain("Stage progression")
    expect(rendered).toContain("Current stage: Verification")
    expect(rendered).toContain("Stages reached: Planning -> Implementation -> Verification")
    expect(rendered).toContain("Timeline")
    expect(rendered).toContain("Artifacts")
    expect(rendered).toContain("Audit")
    expect(rendered).toContain("Verification")
    expect(rendered).toContain("scan_report.json")
    expect(rendered).toContain("Execution completed")
  })

  test(
    "collects a durable session inspect surface from canonical session data",
    async () => {
      const repoRoot = path.resolve(import.meta.dir, "../../../..")
      const summary = await bootstrap(repoRoot, () => collectSessionInspectSummary("ses_32947d739ffeVp11tIEucq7Omg"))

      expect(summary.type).toBe("session_inspect")
      expect(summary.summary.id).toBe("ses_32947d739ffeVp11tIEucq7Omg")
      expect(Array.isArray(summary.stages_reached)).toBe(true)
      expect(Array.isArray(summary.timeline)).toBe(true)
      expect(Array.isArray(summary.artifacts)).toBe(true)
      expect(summary.audit.session_id).toBe("ses_32947d739ffeVp11tIEucq7Omg")
      expect(summary.verification.session_id).toBe("ses_32947d739ffeVp11tIEucq7Omg")
    },
    40000,
  )
})
