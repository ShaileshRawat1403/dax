import { describe, test, expect } from "bun:test"
import {
  ApprovalStatusSchema,
  ApprovalTypeSchema,
  createApproval,
  isPending,
  isTerminal,
  canTransition,
} from "../../src/approval/approval-types"
import { ApprovalTransitions, ApprovalAlreadyResolvedError } from "../../src/approval/approval-transitions"

describe("Approval Types", () => {
  test("createApproval produces valid pending approval", () => {
    const approval = createApproval({
      approvalId: "apr_test123",
      runId: "run_test123",
      type: "file_write",
      risk: "medium",
      title: "Write file requires approval",
      reason: "Creating new file",
      context: { filePath: "/path/to/file.txt" },
    })

    expect(approval.status).toBe("pending")
    expect(approval.approvalId).toBe("apr_test123")
    expect(approval.runId).toBe("run_test123")
    expect(approval.resolvedAt).toBeNull()
    expect(approval.actor).toBeNull()
  })

  test("isPending returns true only for pending status", () => {
    expect(isPending("pending")).toBe(true)
    expect(isPending("approved")).toBe(false)
    expect(isPending("denied")).toBe(false)
    expect(isPending("expired")).toBe(false)
    expect(isPending("cancelled")).toBe(false)
  })

  test("isTerminal returns true for terminal statuses", () => {
    expect(isTerminal("pending")).toBe(false)
    expect(isTerminal("approved")).toBe(true)
    expect(isTerminal("denied")).toBe(true)
    expect(isTerminal("expired")).toBe(true)
    expect(isTerminal("cancelled")).toBe(true)
  })

  test("canTransition validates legal transitions", () => {
    expect(canTransition("pending", "approved")).toBe(true)
    expect(canTransition("pending", "denied")).toBe(true)
    expect(canTransition("pending", "expired")).toBe(true)
    expect(canTransition("pending", "cancelled")).toBe(true)
    expect(canTransition("pending", "pending")).toBe(false)
    expect(canTransition("approved", "denied")).toBe(false)
    expect(canTransition("approved", "approved")).toBe(false)
    expect(canTransition("denied", "approved")).toBe(false)
  })
})

describe("Approval Transitions", () => {
  test("ApprovalAlreadyResolvedError contains correct information", () => {
    const error = new ApprovalAlreadyResolvedError("apr_123", "approved")
    expect(error.approvalId).toBe("apr_123")
    expect(error.currentStatus).toBe("approved")
    expect(error.message).toContain("apr_123")
    expect(error.message).toContain("approved")
  })
})

describe("Approval Schema Validation", () => {
  test("valid approval status parses correctly", () => {
    expect(ApprovalStatusSchema.parse("pending")).toBe("pending")
    expect(ApprovalStatusSchema.parse("approved")).toBe("approved")
    expect(ApprovalStatusSchema.parse("denied")).toBe("denied")
    expect(ApprovalStatusSchema.parse("expired")).toBe("expired")
    expect(ApprovalStatusSchema.parse("cancelled")).toBe("cancelled")
  })

  test("invalid approval status throws", () => {
    expect(() => ApprovalStatusSchema.parse("unknown")).toThrow()
    expect(() => ApprovalStatusSchema.parse("")).toThrow()
  })

  test("valid approval type parses correctly", () => {
    expect(ApprovalTypeSchema.parse("file_write")).toBe("file_write")
    expect(ApprovalTypeSchema.parse("command_execute")).toBe("command_execute")
    expect(ApprovalTypeSchema.parse("patch_apply")).toBe("patch_apply")
    expect(ApprovalTypeSchema.parse("tool_use")).toBe("tool_use")
    expect(ApprovalTypeSchema.parse("workflow_gate")).toBe("workflow_gate")
  })

  test("invalid approval type throws", () => {
    expect(() => ApprovalTypeSchema.parse("unknown")).toThrow()
  })
})
