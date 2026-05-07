import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { RAOAdapter } from "@/rao/adapters"
import type { Approval } from "./approval-types"

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    approvalId: "apr_test0000000001",
    runId: "run_test",
    stepId: null,
    type: "command_execute",
    risk: "high",
    title: "Execute command",
    reason: "Run build script",
    status: "pending",
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    actor: null,
    source: "workflow",
    resolution: null,
    ...overrides,
  }
}

function makeRAOApproval(contextOverrides?: {
  diffPreview?: string
  filePath?: string
  command?: string
  toolName?: string
}): Parameters<typeof RAOAdapter.toRAOApprovalRequest>[0] {
  return {
    approvalId: "apr_rao000001",
    runId: "run_rao",
    stepId: null,
    type: "file_write",
    risk: "medium",
    title: "Write file",
    reason: "Patch source file",
    status: "pending",
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    actor: null,
    source: "workflow",
    resolution: null,
    context: contextOverrides,
  }
}

// --- approval-store hardening (requires bootstrap context) ---

describe("approval-store: addApproval idempotency", () => {
  test(
    "returns stored approval when approval with same id already exists",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-idem`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        await bootstrap(repoRoot, async () => {
          const { addApproval, readApprovals } = await import("./approval-store")
          const runId = `run_idem_${Date.now().toString(36)}`

          const original = makeApproval({
            approvalId: "apr_idem001",
            runId,
            requestedAt: "2024-01-01T00:00:00.000Z",
          })
          const first = await addApproval(runId, original)
          expect(first.requestedAt).toBe("2024-01-01T00:00:00.000Z")

          // Same ID, different timestamp
          const duplicate = makeApproval({
            approvalId: "apr_idem001",
            runId,
            requestedAt: "2024-06-01T00:00:00.000Z",
          })
          const second = await addApproval(runId, duplicate)

          // Must return the original stored approval
          expect(second.requestedAt).toBe("2024-01-01T00:00:00.000Z")

          const stored = await readApprovals(runId)
          expect(stored.length).toBe(1)
          expect(stored[0]!.requestedAt).toBe("2024-01-01T00:00:00.000Z")
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

describe("approval-store: resolveApproval", () => {
  test(
    "resolves a pending approval and persists the decision",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-resolve`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        await bootstrap(repoRoot, async () => {
          const { addApproval, resolveApproval } = await import("./approval-store")
          const runId = `run_resolve_${Date.now().toString(36)}`

          await addApproval(runId, makeApproval({ approvalId: "apr_r001", runId }))
          const resolved = await resolveApproval(runId, "apr_r001", {
            decision: "approve",
            actorId: "operator_1",
          })

          expect(resolved).not.toBeNull()
          expect(resolved!.status).toBe("approved")
          expect(resolved!.actor).toBe("operator_1")
          expect(resolved!.resolution?.decision).toBe("approve")
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "second resolve returns first decision without overwriting",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-double`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        await bootstrap(repoRoot, async () => {
          const { addApproval, resolveApproval, readApprovals } = await import("./approval-store")
          const runId = `run_double_${Date.now().toString(36)}`

          await addApproval(runId, makeApproval({ approvalId: "apr_d001", runId }))

          await resolveApproval(runId, "apr_d001", { decision: "approve", actorId: "actor_a" })

          // Second attempt with different decision
          const second = await resolveApproval(runId, "apr_d001", { decision: "deny", actorId: "actor_b" })

          // Must preserve the first decision
          expect(second!.status).toBe("approved")
          expect(second!.actor).toBe("actor_a")

          const stored = await readApprovals(runId)
          const record = stored.find((a) => a.approvalId === "apr_d001")!
          expect(record.status).toBe("approved")
          expect(record.actor).toBe("actor_a")
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "returns null when approvalId does not exist",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-notfound`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        await bootstrap(repoRoot, async () => {
          const { resolveApproval } = await import("./approval-store")
          const result = await resolveApproval("run_noop", "apr_nonexistent", { decision: "approve" })
          expect(result).toBeNull()
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

// --- RAO adapter: diffPreview (no bootstrap needed) ---

describe("RAOAdapter.toRAOApprovalRequest: diffPreview stats", () => {
  test("returns undefined diffPreview when context has no diffPreview", () => {
    const result = RAOAdapter.toRAOApprovalRequest(makeRAOApproval({ command: "make build" }))
    expect(result.diffPreview).toBeUndefined()
  })

  test("filesChanged=1 for a single-file unified diff", () => {
    const patch = [
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " const x = 1",
      "+const y = 2",
      " export { x }",
    ].join("\n")
    const result = RAOAdapter.toRAOApprovalRequest(makeRAOApproval({ diffPreview: patch }))
    expect(result.diffPreview?.filesChanged).toBe(1)
    expect(result.diffPreview?.additions).toBe(1)
    expect(result.diffPreview?.deletions).toBe(0)
  })

  test("filesChanged counts multiple git diff headers", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +2 @@",
      " unchanged",
      "+added",
    ].join("\n")
    const result = RAOAdapter.toRAOApprovalRequest(makeRAOApproval({ diffPreview: patch }))
    expect(result.diffPreview?.filesChanged).toBe(2)
    expect(result.diffPreview?.additions).toBe(2)
    expect(result.diffPreview?.deletions).toBe(1)
  })

  test("filesChanged=1 minimum even for a headerless patch", () => {
    const patch = " context line\n+added line\n-removed line"
    const result = RAOAdapter.toRAOApprovalRequest(makeRAOApproval({ diffPreview: patch }))
    expect(result.diffPreview?.filesChanged).toBe(1)
  })

  test("patch string is preserved verbatim", () => {
    const patch = "--- a/file\n+++ b/file\n+add"
    const result = RAOAdapter.toRAOApprovalRequest(makeRAOApproval({ diffPreview: patch }))
    expect(result.diffPreview?.patch).toBe(patch)
  })
})
