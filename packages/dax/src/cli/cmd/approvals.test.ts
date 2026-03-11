import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { formatApprovalTable, toApprovalRow } from "./approvals"

describe("approvals command", () => {
  test("formats empty approval state for operators", () => {
    expect(formatApprovalTable([])).toBe("No pending approvals.")
  })

  test("maps runtime request into operator-facing approval row", () => {
    const row = toApprovalRow({
      id: "permission_123",
      createdAt: 1_700_000_000_000,
      sessionID: "session_123",
      permission: "bash",
      patterns: ["npm run build"],
      metadata: { description: "Run build before packaging" },
      always: ["npm run build"],
      tool: {
        messageID: "message_123",
        callID: "call_123",
      },
    })

    expect(row.status).toBe("awaiting_operator_decision")
    expect(row.requested_action).toBe("bash npm run build")
    expect(row.reason).toBe("Run build before packaging")
    expect(row.session_id).toBe("session_123")
  })

  test(
    "reads pending approvals from canonical governance state",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-approvals`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { PermissionNext } = await import("@/governance/next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")

        const repoRoot = path.resolve(import.meta.dir, "../../../..")
        const approvalCommand = `npm test --approval-view ${Date.now().toString(36)}`

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          void PermissionNext.ask({
            sessionID: "session_approval_view",
            permission: "bash",
            patterns: [approvalCommand],
            always: [approvalCommand],
            metadata: { description: "Run test suite" },
            ruleset: PermissionNext.fromConfig({ bash: "ask" } as any),
          })

          const pending = await PermissionNext.list()
          expect(pending.length).toBe(1)

          const row = toApprovalRow(pending[0]!)
          const rendered = formatApprovalTable([row])
          expect(rendered).toContain("Approval ID: " + row.id)
          expect(rendered).toContain("Status: Awaiting operator decision")
          expect(rendered).toContain("Requested operation: bash " + approvalCommand)
          expect(rendered).toContain("Related session: session_approval_view")
          expect(rendered).toContain("Reason: Run test suite")
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )
})
