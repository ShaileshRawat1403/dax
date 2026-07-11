import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { formatApprovalTable, toApprovalRow, toRunApprovalRow } from "./approvals"

async function waitForPending(Permission: { list: () => Promise<any[]> }, count: number): Promise<any[]> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const pending = await Permission.list()
    if (pending.length === count) return pending
    await Bun.sleep(20)
  }
  return Permission.list()
}

describe("approvals command", () => {
  test("formats empty approval state for operators", () => {
    expect(formatApprovalTable([])).toBe("No pending approvals.")
  })

  test("maps runtime request into operator-facing approval row", () => {
    const row = toApprovalRow({
      id: "permission_123",
      createdAt: 1_700_000_000_000,
      sessionID: "session_123",
      permission: "shell",
      patterns: ["npm run build"],
      metadata: { description: "Run build before packaging" },
      always: ["npm run build"],
      tool: {
        messageID: "message_123",
        callID: "call_123",
      },
    })

    expect(row.status).toBe("awaiting_operator_decision")
    expect(row.requested_action).toBe("shell npm run build")
    expect(row.reason).toBe("Run build before packaging")
    expect(row.session_id).toBe("session_123")
  })

  test("maps canonical run approvals for fresh-process worker review", () => {
    const row = toRunApprovalRow({
      approvalId: "apr_worker_1",
      runId: "ses_worker_1",
      type: "patch_apply",
      status: "pending",
      risk: "medium",
      title: "Approve governed Claude Code changes",
      reason: "A kernel-computed diff needs an operator decision.",
      context: {},
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    })

    expect(row).toMatchObject({
      id: "apr_worker_1",
      session_id: "ses_worker_1",
      requested_action: "patch apply",
    })
  })

  test(
    "reads pending approvals from canonical governance state",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-approvals`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("@/governance")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")

        const repoRoot = path.resolve(import.meta.dir, "../../../..")
        const approvalCommand = `npm test --approval-view ${Date.now().toString(36)}`

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          void Permission.ask({
            sessionID: "session_approval_view",
            permission: "shell",
            patterns: [approvalCommand],
            always: [approvalCommand],
            metadata: { description: "Run test suite" },
            ruleset: Permission.fromConfig({ bash: "ask" } as any),
          })

          const pending = await waitForPending(Permission, 1)
          expect(pending.length).toBe(1)

          const row = toApprovalRow(pending[0]!)
          const rendered = formatApprovalTable([row])
          // Table cells: each value appears in its column
          expect(rendered).toContain(row.id)
          expect(rendered).toContain("session_approval_view")
          expect(rendered).toContain("shell " + approvalCommand)
          expect(rendered).toContain("Run test suite")
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
