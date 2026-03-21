import { describe, test, expect } from "bun:test"
import { isTerminalStatus, isLegalTransition, LEGAL_TRANSITIONS, RunStatusSchema } from "../../src/state/run-state"
import { isPending, isTerminal, canTransition, createApproval } from "../../src/approval/approval-types"
import { ApprovalAlreadyResolvedError } from "../../src/approval/approval-transitions"

describe("Run State Transitions - Pure Logic", () => {
  test("isLegalTransition validates legal transitions", () => {
    expect(isLegalTransition("created", "compiled")).toBe(true)
    expect(isLegalTransition("created", "cancelled")).toBe(true)
    expect(isLegalTransition("compiled", "queued")).toBe(true)
    expect(isLegalTransition("compiled", "cancelled")).toBe(true)
    expect(isLegalTransition("queued", "running")).toBe(true)
    expect(isLegalTransition("queued", "cancelled")).toBe(true)
    expect(isLegalTransition("running", "waiting_approval")).toBe(true)
    expect(isLegalTransition("running", "completed")).toBe(true)
    expect(isLegalTransition("running", "failed")).toBe(true)
    expect(isLegalTransition("running", "cancelled")).toBe(true)
    expect(isLegalTransition("waiting_approval", "running")).toBe(true)
    expect(isLegalTransition("waiting_approval", "cancelled")).toBe(true)
    expect(isLegalTransition("waiting_approval", "failed")).toBe(true)
  })

  test("isLegalTransition rejects illegal transitions", () => {
    expect(isLegalTransition("created", "running")).toBe(false)
    expect(isLegalTransition("created", "completed")).toBe(false)
    expect(isLegalTransition("completed", "running")).toBe(false)
    expect(isLegalTransition("completed", "waiting_approval")).toBe(false)
    expect(isLegalTransition("failed", "running")).toBe(false)
    expect(isLegalTransition("cancelled", "running")).toBe(false)
    expect(isLegalTransition("queued", "completed")).toBe(false)
    expect(isLegalTransition("waiting_approval", "completed")).toBe(false)
  })

  test("isTerminalStatus identifies terminal states", () => {
    expect(isTerminalStatus("completed")).toBe(true)
    expect(isTerminalStatus("failed")).toBe(true)
    expect(isTerminalStatus("cancelled")).toBe(true)
    expect(isTerminalStatus("created")).toBe(false)
    expect(isTerminalStatus("compiled")).toBe(false)
    expect(isTerminalStatus("queued")).toBe(false)
    expect(isTerminalStatus("running")).toBe(false)
    expect(isTerminalStatus("waiting_approval")).toBe(false)
  })

  test("LEGAL_TRANSITIONS has correct structure", () => {
    expect(LEGAL_TRANSITIONS.created).toContain("compiled")
    expect(LEGAL_TRANSITIONS.created).toContain("cancelled")
    expect(LEGAL_TRANSITIONS.completed).toHaveLength(0)
    expect(LEGAL_TRANSITIONS.failed).toHaveLength(0)
    expect(LEGAL_TRANSITIONS.cancelled).toHaveLength(0)
    expect(LEGAL_TRANSITIONS.running).toContain("completed")
    expect(LEGAL_TRANSITIONS.running).toContain("failed")
    expect(LEGAL_TRANSITIONS.waiting_approval).toContain("running")
  })

  test("no transitions from terminal states", () => {
    expect(LEGAL_TRANSITIONS.completed).toHaveLength(0)
    expect(LEGAL_TRANSITIONS.failed).toHaveLength(0)
    expect(LEGAL_TRANSITIONS.cancelled).toHaveLength(0)
  })
})

describe("Approval Transitions - Pure Logic", () => {
  test("isPending validates pending status", () => {
    expect(isPending("pending")).toBe(true)
    expect(isPending("approved")).toBe(false)
    expect(isPending("denied")).toBe(false)
    expect(isPending("expired")).toBe(false)
    expect(isPending("cancelled")).toBe(false)
  })

  test("isTerminal validates terminal statuses", () => {
    expect(isTerminal("pending")).toBe(false)
    expect(isTerminal("approved")).toBe(true)
    expect(isTerminal("denied")).toBe(true)
    expect(isTerminal("expired")).toBe(true)
    expect(isTerminal("cancelled")).toBe(true)
  })

  test("canTransition validates legal approval transitions", () => {
    expect(canTransition("pending", "approved")).toBe(true)
    expect(canTransition("pending", "denied")).toBe(true)
    expect(canTransition("pending", "expired")).toBe(true)
    expect(canTransition("pending", "cancelled")).toBe(true)
  })

  test("canTransition rejects illegal transitions", () => {
    expect(canTransition("pending", "pending")).toBe(false)
    expect(canTransition("approved", "denied")).toBe(false)
    expect(canTransition("denied", "approved")).toBe(false)
    expect(canTransition("approved", "approved")).toBe(false)
    expect(canTransition("expired", "approved")).toBe(false)
  })

  test("createApproval produces valid pending approval", () => {
    const approval = createApproval({
      approvalId: "apr_test123",
      runId: "run_test123",
      type: "file_write",
      risk: "medium",
      title: "Test approval",
      reason: "Test reason",
      context: { filePath: "/path/to/file.txt" },
    })

    expect(approval.status).toBe("pending")
    expect(approval.approvalId).toBe("apr_test123")
    expect(approval.runId).toBe("run_test123")
    expect(approval.type).toBe("file_write")
    expect(approval.risk).toBe("medium")
    expect(approval.resolvedAt).toBeNull()
    expect(approval.actor).toBeNull()
    expect(approval.resolution).toBeNull()
    expect(approval.source).toBe("workflow")
  })

  test("createApproval with default source", () => {
    const approval = createApproval({
      approvalId: "apr_test",
      runId: "run_test",
      type: "tool_use",
      risk: "low",
      title: "Test",
      reason: "Test",
    })

    expect(approval.source).toBe("workflow")
  })

  test("createApproval with explicit source", () => {
    const approval = createApproval({
      approvalId: "apr_test",
      runId: "run_test",
      type: "tool_use",
      risk: "low",
      title: "Test",
      reason: "Test",
      source: "permission",
    })

    expect(approval.source).toBe("permission")
  })
})

describe("ApprovalTransitionError", () => {
  test("ApprovalAlreadyResolvedError contains correct info", () => {
    const error = new ApprovalAlreadyResolvedError("apr_123", "approved")
    expect(error.approvalId).toBe("apr_123")
    expect(error.currentStatus).toBe("approved")
    expect(error.name).toBe("ApprovalAlreadyResolvedError")
    expect(error.message).toContain("apr_123")
    expect(error.message).toContain("approved")
  })
})

describe("RunStatus Schema", () => {
  test("valid status values parse correctly", () => {
    expect(RunStatusSchema.parse("created")).toBe("created")
    expect(RunStatusSchema.parse("compiled")).toBe("compiled")
    expect(RunStatusSchema.parse("queued")).toBe("queued")
    expect(RunStatusSchema.parse("running")).toBe("running")
    expect(RunStatusSchema.parse("waiting_approval")).toBe("waiting_approval")
    expect(RunStatusSchema.parse("completed")).toBe("completed")
    expect(RunStatusSchema.parse("failed")).toBe("failed")
    expect(RunStatusSchema.parse("cancelled")).toBe("cancelled")
  })

  test("invalid status throws", () => {
    expect(() => RunStatusSchema.parse("invalid")).toThrow()
    expect(() => RunStatusSchema.parse("")).toThrow()
  })
})

describe("Determinism Guarantees", () => {
  test("terminal states cannot transition", () => {
    const terminalStates: Array<keyof typeof LEGAL_TRANSITIONS> = ["completed", "failed", "cancelled"]
    const nonTerminalStates: Array<keyof typeof LEGAL_TRANSITIONS> = [
      "created",
      "compiled",
      "queued",
      "running",
      "waiting_approval",
    ]

    for (const terminal of terminalStates) {
      for (const nonTerminal of nonTerminalStates) {
        expect(isLegalTransition(terminal, nonTerminal)).toBe(false)
      }
    }
  })

  test("waiting_approval can only go to running, cancelled, or failed", () => {
    const legalNext = LEGAL_TRANSITIONS.waiting_approval
    expect(legalNext).toContain("running")
    expect(legalNext).toContain("cancelled")
    expect(legalNext).toContain("failed")
    expect(legalNext).not.toContain("completed")
    expect(legalNext).not.toContain("queued")
  })

  test("running can go to multiple states", () => {
    const legalNext = LEGAL_TRANSITIONS.running
    expect(legalNext).toContain("waiting_approval")
    expect(legalNext).toContain("completed")
    expect(legalNext).toContain("failed")
    expect(legalNext).toContain("cancelled")
  })

  test("approval state machine is strict", () => {
    expect(canTransition("pending", "approved")).toBe(true)
    expect(canTransition("pending", "denied")).toBe(true)
    expect(canTransition("pending", "expired")).toBe(true)
    expect(canTransition("pending", "cancelled")).toBe(true)

    expect(canTransition("approved", "denied")).toBe(false)
    expect(canTransition("denied", "approved")).toBe(false)
    expect(canTransition("expired", "cancelled")).toBe(false)
  })
})
