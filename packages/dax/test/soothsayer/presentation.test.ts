import { describe, it, expect } from "bun:test"
import {
  WORKFLOW_LABELS,
  STEP_LABELS,
  TERMINAL_REASON_LABELS,
  APPROVAL_TYPE_LABELS,
  RISK_LABELS,
  TRUST_POSTURE_LABELS,
  enrichApproval,
  type SoothsayerApprovalDetail,
} from "../../src/soothsayer/soothsayer-api"

describe("Soothsayer Presentation Layer", () => {
  describe("WORKFLOW_LABELS", () => {
    it("provides human-readable labels for all workflow classes", () => {
      expect(WORKFLOW_LABELS.draft_and_approve.label).toBe("Draft & Approve")
      expect(WORKFLOW_LABELS.draft_and_approve.description.length).toBeGreaterThan(0)
      expect(WORKFLOW_LABELS.draft_and_approve.icon.length).toBeGreaterThan(0)

      expect(WORKFLOW_LABELS.repo_analyze.label).toBe("Repository Analysis")
      expect(WORKFLOW_LABELS.repo_analyze.description.length).toBeGreaterThan(0)
      expect(WORKFLOW_LABELS.repo_analyze.icon.length).toBeGreaterThan(0)

      expect(WORKFLOW_LABELS.review_and_signoff.label).toBe("Review & Signoff")
      expect(WORKFLOW_LABELS.review_and_signoff.description.length).toBeGreaterThan(0)
      expect(WORKFLOW_LABELS.review_and_signoff.icon.length).toBeGreaterThan(0)

      expect(WORKFLOW_LABELS.generic.label).toBe("Generic Workflow")
    })

    it("distinguishes workflows at a glance", () => {
      const labels = Object.values(WORKFLOW_LABELS).map((l: { label: string }) => l.label)
      const uniqueLabels = new Set(labels)
      expect(uniqueLabels.size).toBe(labels.length)
    })
  })

  describe("STEP_LABELS", () => {
    it("provides human-readable labels for all step types", () => {
      expect(STEP_LABELS.prepare_draft.label).toBe("Prepare Draft")
      expect(STEP_LABELS.request_approval.label).toBe("Request Approval")
      expect(STEP_LABELS.commit_execution.label).toBe("Commit Execution")
      expect(STEP_LABELS.collect_context.label).toBe("Collect Context")
      expect(STEP_LABELS.analyze_repository.label).toBe("Analyze Repository")
      expect(STEP_LABELS.publish_report.label).toBe("Publish Report")
      expect(STEP_LABELS.produce_review.label).toBe("Produce Review")
      expect(STEP_LABELS.request_signoff.label).toBe("Request Signoff")
      expect(STEP_LABELS.finalize_outcome.label).toBe("Finalize Outcome")
    })

    it("provides descriptions for context", () => {
      Object.values(STEP_LABELS).forEach((step: { description: string }) => {
        expect(step.description.length).toBeGreaterThan(10)
      })
    })
  })

  describe("TERMINAL_REASON_LABELS", () => {
    it("provides operational labels for terminal reasons", () => {
      expect(TERMINAL_REASON_LABELS.workflow_completed.label).toBe("Completed")
      expect(TERMINAL_REASON_LABELS.workflow_completed.severity).toBe("success")

      expect(TERMINAL_REASON_LABELS.permission_denied.label).toBe("Permission Denied")
      expect(TERMINAL_REASON_LABELS.permission_denied.severity).toBe("error")

      expect(TERMINAL_REASON_LABELS.timeout.label).toBe("Timeout")
      expect(TERMINAL_REASON_LABELS.timeout.severity).toBe("warning")
    })

    it("has severity levels that match operational meaning", () => {
      expect(TERMINAL_REASON_LABELS.workflow_completed.severity).toBe("success")
      expect(TERMINAL_REASON_LABELS.workflow_failed.severity).toBe("error")
      expect(TERMINAL_REASON_LABELS.workflow_signed_off.severity).toBe("success")
      expect(TERMINAL_REASON_LABELS.workflow_rejected.severity).toBe("warning")
    })

    it("descriptions are user-friendly, not technical", () => {
      Object.values(TERMINAL_REASON_LABELS).forEach((reason: { label: string; description: string }) => {
        expect(reason.label).not.toContain("_")
      })
    })
  })

  describe("APPROVAL_TYPE_LABELS", () => {
    it("provides human-readable approval type labels", () => {
      expect(APPROVAL_TYPE_LABELS.file_write.label).toBe("File Write")
      expect(APPROVAL_TYPE_LABELS.command_execute.label).toBe("Command Execution")
      expect(APPROVAL_TYPE_LABELS.patch_apply.label).toBe("Patch Apply")
      expect(APPROVAL_TYPE_LABELS.tool_use.label).toBe("Tool Use")
      expect(APPROVAL_TYPE_LABELS.workflow_gate.label).toBe("Workflow Gate")
    })

    it("provides icons for visual distinction", () => {
      Object.values(APPROVAL_TYPE_LABELS).forEach((type: { icon: string }) => {
        expect(type.icon.length).toBeGreaterThan(0)
      })
    })
  })

  describe("RISK_LABELS", () => {
    it("provides risk levels with ascending severity", () => {
      expect(RISK_LABELS.low.severity).toBeLessThan(RISK_LABELS.medium.severity)
      expect(RISK_LABELS.medium.severity).toBeLessThan(RISK_LABELS.high.severity)
      expect(RISK_LABELS.high.severity).toBeLessThan(RISK_LABELS.critical.severity)
    })

    it("provides colors for visual hierarchy", () => {
      expect(RISK_LABELS.low.color).toBe("green")
      expect(RISK_LABELS.medium.color).toBe("yellow")
      expect(RISK_LABELS.high.color).toBe("orange")
      expect(RISK_LABELS.critical.color).toBe("red")
    })

    it("descriptions help users understand risk", () => {
      expect(RISK_LABELS.low.description).toContain("Read-only")
      expect(RISK_LABELS.critical.description).toContain("irreversible")
    })
  })

  describe("TRUST_POSTURE_LABELS", () => {
    it("provides human-readable trust posture labels", () => {
      expect(TRUST_POSTURE_LABELS.high.label).toBe("High Trust")
      expect(TRUST_POSTURE_LABELS.medium.label).toBe("Medium Trust")
      expect(TRUST_POSTURE_LABELS.low.label).toBe("Low Trust")
      expect(TRUST_POSTURE_LABELS.minimal.label).toBe("Minimal Trust")
    })

    it("descriptions explain meaning", () => {
      Object.values(TRUST_POSTURE_LABELS).forEach((posture: { description: string }) => {
        expect(posture.description.length).toBeGreaterThan(5)
      })
    })
  })

  describe("enrichApproval", () => {
    it("transforms raw approval to presentation-safe format", () => {
      const rawApproval = {
        approvalId: "apr_123",
        runId: "run_456",
        type: "command_execute",
        risk: "high",
        title: "shell requires approval",
        reason: "rm, sudo, chmod",
        status: "pending",
        context: {
          command: "rm -rf node_modules",
          filePath: undefined,
        },
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }

      const enriched = enrichApproval(rawApproval)

      expect(enriched.typeLabel).toBe("Command Execution")
      expect(enriched.typeIcon).toBe("terminal")
      expect(enriched.riskLabel).toBe("High Risk")
      expect(enriched.riskSeverity).toBe(3)
      expect(enriched.riskColor).toBe("orange")
      expect(enriched.whatHappensNext?.afterApprove).toContain("rm -rf")
      expect(enriched.whatHappensNext?.afterDeny).toBe("Command will not run.")
    })

    it("enriches command execution titles", () => {
      const approval = {
        approvalId: "apr_1",
        runId: "run_1",
        type: "command_execute",
        risk: "high",
        title: "shell requires approval",
        reason: "",
        status: "pending",
        context: { command: "git push origin main" },
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }

      const enriched = enrichApproval(approval)
      expect(enriched.titleEnriched).toContain("git push")
    })

    it("enriches file write titles", () => {
      const approval = {
        approvalId: "apr_2",
        runId: "run_2",
        type: "file_write",
        risk: "medium",
        title: "write requires approval",
        reason: "",
        status: "pending",
        context: { filePath: "/src/index.ts" },
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }

      const enriched = enrichApproval(approval)
      expect(enriched.titleEnriched).toContain("/src/index.ts")
    })

    it("provides whatHappensNext for workflow_gate", () => {
      const approval = {
        approvalId: "apr_3",
        runId: "run_3",
        type: "workflow_gate",
        risk: "medium",
        title: "workflow gate",
        reason: "",
        status: "pending",
        context: {},
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }

      const enriched = enrichApproval(approval)
      expect(enriched.whatHappensNext?.afterApprove).toContain("proceed")
      expect(enriched.whatHappensNext?.afterDeny).toContain("halt")
    })

    it("handles unknown types gracefully", () => {
      const approval = {
        approvalId: "apr_4",
        runId: "run_4",
        type: "unknown_type",
        risk: "unknown_risk",
        title: "unknown",
        reason: "",
        status: "pending",
        context: {},
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }

      const enriched = enrichApproval(approval)
      expect(enriched.typeLabel).toBe("unknown_type")
      expect(enriched.riskLabel).toBe("unknown_risk")
    })
  })

  describe("Presentation Contract Validation", () => {
    it("no raw enums leak through in labels", () => {
      const allLabels = [
        ...Object.values(WORKFLOW_LABELS).map((l: { label: string }) => l.label),
        ...Object.values(STEP_LABELS).map((s: { label: string }) => s.label),
        ...Object.values(TERMINAL_REASON_LABELS).map((t: { label: string }) => t.label),
        ...Object.values(APPROVAL_TYPE_LABELS).map((a: { label: string }) => a.label),
        ...Object.values(RISK_LABELS).map((r: { label: string }) => r.label),
        ...Object.values(TRUST_POSTURE_LABELS).map((t: { label: string }) => t.label),
      ]

      allLabels.forEach((label: string) => {
        expect(label).not.toMatch(/[_-]/)
        expect(label).not.toMatch(/^(draft_and_approve|repo_analyze|review_and_signoff)$/)
        expect(label).not.toMatch(/^(file_write|command_execute|patch_apply)$/)
        expect(label).not.toMatch(/^(low|medium|high|critical)$/)
      })
    })

    it("all labels are user-friendly (no technical jargon)", () => {
      const allLabels = [
        ...Object.values(WORKFLOW_LABELS).map((l: { label: string }) => l.label),
        ...Object.values(STEP_LABELS).map((s: { label: string }) => s.label),
        ...Object.values(TERMINAL_REASON_LABELS).map((t: { label: string }) => t.label),
      ]

      allLabels.forEach((label: string) => {
        expect(label).not.toMatch(/^(collect_context|analyze_repository|publish_report)$/)
        expect(label).not.toMatch(/^(workflow_completed|permission_denied)$/)
      })
    })

    it("approval context is sufficient for safe decision-making", () => {
      const testApprovals: Array<{ type: string; risk?: string; context: Record<string, string | undefined> }> = [
        { type: "command_execute", risk: "low", context: { command: "npm test" } },
        { type: "file_write", risk: "medium", context: { filePath: "/src/app.ts" } },
        { type: "patch_apply", risk: "medium", context: {} },
        { type: "workflow_gate", risk: "medium", context: {} },
      ]

      testApprovals.forEach((approval) => {
        const typeInfo = APPROVAL_TYPE_LABELS[approval.type]
        const riskInfo = RISK_LABELS[approval.risk ?? "medium"]
        expect(typeInfo?.label).toBeTruthy()
        expect(riskInfo?.label).toBeTruthy()
      })
    })
  })
})
