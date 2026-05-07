import { describe, expect, test } from "bun:test"
import { isPendingApproval, pendingApprovals, pendingApprovalCount } from "./approvals"

describe("approval selectors", () => {
  describe("isPendingApproval", () => {
    test("status pending → true", () => {
      expect(isPendingApproval({ status: "pending" })).toBe(true)
    })

    test.each([
      ["approved"],
      ["denied"],
      ["expired"],
      ["cancelled"],
    ] as const)("status %s → false", (status) => {
      expect(isPendingApproval({ status })).toBe(false)
    })

    test("missing status → false (defensive default)", () => {
      expect(isPendingApproval({})).toBe(false)
    })

    test("null status → false (defensive default)", () => {
      expect(isPendingApproval({ status: null })).toBe(false)
    })

    test("unknown status string → false", () => {
      expect(isPendingApproval({ status: "in_review" })).toBe(false)
    })
  })

  describe("pendingApprovals", () => {
    test("returns only pending records, preserves order", () => {
      const records = [
        { id: "a", status: "approved" as const },
        { id: "b", status: "pending" as const },
        { id: "c", status: "denied" as const },
        { id: "d", status: "pending" as const },
        { id: "e", status: "expired" as const },
      ]
      const result = pendingApprovals(records)
      expect(result.map((r) => r.id)).toEqual(["b", "d"])
    })

    test("empty input → empty output", () => {
      expect(pendingApprovals([])).toEqual([])
    })

    test("all resolved → empty output", () => {
      const records = [
        { status: "approved" as const },
        { status: "denied" as const },
        { status: "cancelled" as const },
      ]
      expect(pendingApprovals(records)).toEqual([])
    })

    test("preserves the original record shape (generic over T)", () => {
      const record = { id: "x", status: "pending" as const, label: "do thing", custom: 42 }
      const [first] = pendingApprovals([record])
      expect(first).toEqual(record)
    })
  })

  describe("pendingApprovalCount", () => {
    test("counts only pending approvals, adds question count", () => {
      const records = [
        { status: "pending" as const },
        { status: "approved" as const },
        { status: "pending" as const },
        { status: "denied" as const },
      ]
      expect(pendingApprovalCount(records, 2)).toBe(4) // 2 pending + 2 questions
    })

    test("question count defaults to zero", () => {
      const records = [{ status: "pending" as const }]
      expect(pendingApprovalCount(records)).toBe(1)
    })

    test("all resolved approvals + zero questions → zero", () => {
      const records = [
        { status: "approved" as const },
        { status: "denied" as const },
        { status: "expired" as const },
        { status: "cancelled" as const },
      ]
      expect(pendingApprovalCount(records, 0)).toBe(0)
    })

    test("the screenshot scenario: 3 historical approvals, 0 actually pending", () => {
      const records = [
        { id: "permission_1", status: "approved" as const },
        { id: "permission_2", status: "denied" as const },
        { id: "permission_3", status: "expired" as const },
      ]
      // Bug: raw .length would say 3 ("3 APPROVALS PENDING" in trust banner)
      expect(records.length).toBe(3)
      // Fix: selector says 0 (matches what RAO pane shows: "All clear")
      expect(pendingApprovalCount(records)).toBe(0)
    })
  })
})
