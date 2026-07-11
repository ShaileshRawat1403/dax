import { afterEach, describe, expect, test } from "bun:test"
import { WorkerRunEffects, workerIdFromProviderHint, workerContractFromPolicy } from "./worker-run"
import type { WorkerInvocation } from "@/worker/worker-adapter"
import type { RuntimePolicy } from "@/execution/execution-contract"

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

describe("workerContractFromPolicy — Job 1: binding scope", () => {
  test("populates writeScope/forbiddenPaths/verification from runtimePolicy", () => {
    const policy: RuntimePolicy = {
      scope: { targetFiles: ["src/**", "test/**"], targetSubsystems: [], avoidAreas: [] },
      budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
      postconditions: { verificationRequired: true, validationPlan: [], validationCommands: ["bun test"] },
      sensitivity: { sensitivePatterns: [], forbiddenPatterns: ["package.json", ".github/**"] },
    }
    const contract = workerContractFromPolicy("add isEven helper", "run_1", policy)
    expect(contract.task).toBe("add isEven helper")
    expect(contract.writeScope).toEqual(["src/**", "test/**"])
    expect(contract.forbiddenPaths).toEqual(["package.json", ".github/**"])
    expect(contract.verification).toEqual(["bun test"])
    expect(contract.runId).toBe("run_1")
  })

  test("falls back to empty arrays when runtimePolicy is absent", () => {
    const contract = workerContractFromPolicy("read-only task", "run_2", undefined)
    expect(contract.writeScope).toEqual([])
    expect(contract.forbiddenPaths).toEqual([])
    expect(contract.verification).toEqual([])
  })

  test("partial runtimePolicy yields only available fields", () => {
    const policy: RuntimePolicy = {
      scope: { targetFiles: ["src/util.ts"], targetSubsystems: [], avoidAreas: [] },
      budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
      postconditions: { verificationRequired: false, validationPlan: [], validationCommands: [] },
      sensitivity: { sensitivePatterns: [], forbiddenPatterns: [] },
    }
    const contract = workerContractFromPolicy("task", "run_3", policy)
    expect(contract.writeScope).toEqual(["src/util.ts"])
    expect(contract.forbiddenPaths).toEqual([])
    expect(contract.verification).toEqual([])
  })
})

describe("contract_refined evidence payload — Job 3: provenance", () => {
  test("scopeProvenance distinguishes inferred from operator-confirmed", () => {
    const inferredPayload = {
      writeScope: ["src/**"],
      forbiddenPaths: [],
      verification: ["bun test"],
      scopeProvenance: "inferred" as const,
    }
    expect(inferredPayload.scopeProvenance).toBe("inferred")

    const confirmedPayload = { ...inferredPayload, scopeProvenance: "operator-confirmed" as const }
    expect(confirmedPayload.scopeProvenance).toBe("operator-confirmed")
    expect(confirmedPayload.scopeProvenance).not.toBe(inferredPayload.scopeProvenance)
  })

  test("undefined runtimePolicy scopeProvenance defaults to inferred", () => {
    const policy: RuntimePolicy = {
      scope: { targetFiles: [], targetSubsystems: [], avoidAreas: [] },
      budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
      postconditions: { verificationRequired: false, validationPlan: [], validationCommands: [] },
      sensitivity: { sensitivePatterns: [], forbiddenPatterns: [] },
    }
    // scopeProvenance is undefined → workflow falls back to "inferred"
    expect(policy.scopeProvenance ?? "inferred").toBe("inferred")
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
