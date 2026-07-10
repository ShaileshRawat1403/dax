import { afterEach, describe, expect, test } from "bun:test"
import { WorkerRunEffects, workerIdFromProviderHint } from "./worker-run"
import type { WorkerInvocation } from "@/worker/worker-adapter"

afterEach(() => WorkerRunEffects.reset())

describe("workerIdFromProviderHint", () => {
  test("parses governed worker hints and rejects everything else", () => {
    expect(workerIdFromProviderHint("worker:claude")).toBe("claude")
    expect(workerIdFromProviderHint("worker:codex")).toBe("codex")
    expect(workerIdFromProviderHint("worker:gemini")).toBe("gemini")
    expect(workerIdFromProviderHint("worker:copilot")).toBeNull()
    expect(workerIdFromProviderHint("claude")).toBeNull()
    expect(workerIdFromProviderHint(undefined)).toBeNull()
  })
})

describe("WorkerRunEffects seam", () => {
  test("effects can be swapped for tests and restored", async () => {
    const calls: string[] = []
    WorkerRunEffects.set({
      async createCheckout(repoPath, runId) {
        calls.push(`checkout:${repoPath}:${runId}`)
        return { path: "/tmp/fake-checkout", cleanup: async () => void calls.push("cleanup") }
      },
      async runWorker(invocation: WorkerInvocation, cwd: string) {
        calls.push(`run:${invocation.workerId}:${cwd}`)
        return { exitCode: 0, stdout: "done", stderr: "" }
      },
      async computeDiff() {
        calls.push("diff")
        return "diff --git a/src/x.ts b/src/x.ts\n+added"
      },
    })

    const checkout = await WorkerRunEffects.current.createCheckout("/repo", "run_1")
    const result = await WorkerRunEffects.current.runWorker(
      { workerId: "claude", command: ["claude", "-p", "x"], env: {}, network: "full", timeoutMs: 1000 },
      checkout.path,
    )
    const diff = await WorkerRunEffects.current.computeDiff(checkout.path)
    await checkout.cleanup()

    expect(result.exitCode).toBe(0)
    expect(diff).toContain("+added")
    expect(calls).toEqual(["checkout:/repo:run_1", "run:claude:/tmp/fake-checkout", "diff", "cleanup"])

    WorkerRunEffects.reset()
    expect(WorkerRunEffects.current.createCheckout).not.toBeUndefined()
  })
})
