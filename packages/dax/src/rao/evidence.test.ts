import { describe, expect, test } from "bun:test"
import { EvidenceFactory } from "./evidence"
import { RAOProtocol } from "./schema"

describe("EvidenceFactory.createFromAudit", () => {
  test("a blocking finding yields a failed-audit receipt", () => {
    const r = EvidenceFactory.createFromAudit("run_1", "find_1", "No secrets in diff", "fail", true)
    expect(r.claim).toBe("Failed Audit: No secrets in diff")
    expect(r.source).toBe("dax_audit_engine")
    expect(r.runId).toBe("run_1")
    expect(r.receiptId.startsWith("evd_")).toBeTrue()
    expect(JSON.parse(r.proof)).toEqual({ findingId: "find_1", status: "fail", isBlocking: true })
    expect(() => RAOProtocol.EvidenceReceipt.parse(r)).not.toThrow()
  })

  test("a non-blocking finding yields a passed-audit receipt", () => {
    const r = EvidenceFactory.createFromAudit("run_1", "find_2", "Lint clean", "pass", false)
    expect(r.claim).toBe("Audit Passed: Lint clean")
  })
})

describe("EvidenceFactory.createFromApproval", () => {
  test("records the decision and actor in a schema-valid receipt", () => {
    const r = EvidenceFactory.createFromApproval("run_1", "apr_1", "allow", "alice")
    expect(r.claim).toBe("Approval ALLOW for apr_1")
    expect(r.source).toBe("dax_operator_plane")
    expect(JSON.parse(r.proof)).toEqual({ approvalId: "apr_1", decision: "allow", actorId: "alice" })
    expect(() => RAOProtocol.EvidenceReceipt.parse(r)).not.toThrow()
  })

  test("defaults an unknown actor when none is given", () => {
    const r = EvidenceFactory.createFromApproval("run_1", "apr_2", "deny")
    expect(JSON.parse(r.proof).actorId).toBe("unknown")
  })
})
