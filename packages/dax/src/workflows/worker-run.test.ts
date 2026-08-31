import { afterEach, describe, expect, test } from "bun:test"
import {
  WorkerPatchSchema,
  WorkerProcessResultSchema,
  WorkerRunEffects,
  validateWorkerPatchScope,
  workerIdFromProviderHint,
  workerContractFromPolicy,
} from "./worker-run"
import type { WorkerInvocation } from "@/worker/worker-adapter"
import type { RuntimePolicy } from "@/execution/execution-contract"

afterEach(() => WorkerRunEffects.reset())

describe("workerIdFromProviderHint", () => {
  test("parses governed worker hints and rejects everything else", () => {
    expect(workerIdFromProviderHint("worker:claude")).toBe("claude")
    expect(workerIdFromProviderHint("worker:codex")).toBe("codex")
    expect(workerIdFromProviderHint("worker:gemini")).toBe("gemini")
    expect(workerIdFromProviderHint("worker:antigravity")).toBe("antigravity")
    expect(workerIdFromProviderHint("worker:copilot")).toBeNull()
    expect(workerIdFromProviderHint("claude")).toBeNull()
    expect(workerIdFromProviderHint(undefined)).toBeNull()
  })
})

describe("worker observation runtime boundaries", () => {
  test("accepts truthful process and kernel-diff observations", () => {
    expect(
      WorkerProcessResultSchema.parse({
        exitCode: 0,
        stdout: "done",
        stderr: "",
        timedOut: false,
        sandboxProvider: "seatbelt",
        reapedDescendants: false,
        deniedEgress: [],
      }),
    ).toBeDefined()
    expect(
      WorkerPatchSchema.parse({
        content: "diff --git a/src/x.ts b/src/x.ts\n+added",
        changedPaths: ["src/x.ts"],
      }),
    ).toBeDefined()
  })

  test("rejects malformed and unknown process observation fields", () => {
    expect(() =>
      WorkerProcessResultSchema.parse({ exitCode: "zero", stdout: "", stderr: "" }),
    ).toThrow()
    expect(() =>
      WorkerProcessResultSchema.parse({ exitCode: 0, stdout: "", stderr: "", trusted: true }),
    ).toThrow()
  })

  test("rejects malformed and unknown kernel-diff observation fields", () => {
    expect(() => WorkerPatchSchema.parse({ content: "diff", changedPaths: [42] })).toThrow()
    expect(() =>
      WorkerPatchSchema.parse({ content: "diff", changedPaths: ["src/x.ts"], workerClaim: true }),
    ).toThrow()
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

describe("contract_refined evidence payload — Job 3: three-state per-field provenance", () => {
  test("all three provenance states are distinct", () => {
    const states = ["operator-authored", "operator-confirmed", "inferred-unreviewed"] as const
    expect(new Set(states).size).toBe(3)
  })

  test("per-field provenance payload shape is correct", () => {
    const payload = {
      writeScope: ["src/**"],
      forbiddenPaths: ["package.json"],
      verification: ["bun test"],
      provenance: {
        writeScope: "operator-confirmed" as const,
        forbiddenPaths: "operator-authored" as const,
        verification: "inferred-unreviewed" as const,
      },
    }
    expect(payload.provenance.writeScope).toBe("operator-confirmed")
    expect(payload.provenance.forbiddenPaths).toBe("operator-authored")
    expect(payload.provenance.verification).toBe("inferred-unreviewed")
  })

  test("absent runtimePolicy provenance defaults to inferred-unreviewed for all fields", () => {
    const policy: RuntimePolicy = {
      scope: { targetFiles: [], targetSubsystems: [], avoidAreas: [] },
      budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
      postconditions: { verificationRequired: false, validationPlan: [], validationCommands: [] },
      sensitivity: { sensitivePatterns: [], forbiddenPatterns: [] },
    }
    const fallback = policy.provenance ?? {
      writeScope: "inferred-unreviewed",
      forbiddenPaths: "inferred-unreviewed",
      verification: "inferred-unreviewed",
    }
    expect(fallback.writeScope).toBe("inferred-unreviewed")
    expect(fallback.forbiddenPaths).toBe("inferred-unreviewed")
    expect(fallback.verification).toBe("inferred-unreviewed")
  })

  test("CLI-authored field stays operator-authored regardless of card interaction", () => {
    // Simulate: --forbid was set, writeScope and verify were inferred + card accepted
    const provenance = {
      writeScope: "operator-confirmed" as const,   // inferred + Enter
      forbiddenPaths: "operator-authored" as const, // CLI flag
      verification: "operator-confirmed" as const,  // inferred + Enter
    }
    expect(provenance.forbiddenPaths).toBe("operator-authored")
    expect(provenance.writeScope).not.toBe("operator-authored")
    expect(provenance.verification).not.toBe("operator-authored")
  })
})

describe("validateWorkerPatchScope", () => {
  const contract = workerContractFromPolicy("add isEven helper", "run_scope", {
    scope: { targetFiles: ["src/**", "test/**"], targetSubsystems: [], avoidAreas: [] },
    budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
    postconditions: { verificationRequired: true, validationPlan: [], validationCommands: ["bun test"] },
    sensitivity: { sensitivePatterns: [], forbiddenPatterns: ["package.json", ".github/**"] },
  })

  test("allows Git-derived paths inside the write scope", () => {
    expect(validateWorkerPatchScope(["src/math.ts", "test/math.test.ts"], contract)).toEqual([])
  })

  test("fails closed when a worker changes an explicitly forbidden path", () => {
    expect(validateWorkerPatchScope(["src/math.ts", "package.json"], contract)).toEqual([
      { path: "package.json", kind: "forbidden", patterns: ["package.json"] },
    ])
  })

  test("fails closed when a worker changes a path outside the approved write scope", () => {
    expect(validateWorkerPatchScope(["scripts/release.ts"], contract)).toEqual([
      { path: "scripts/release.ts", kind: "outside_write_scope", patterns: ["src/**", "test/**"] },
    ])
  })

  test("treats an empty write scope as unrestricted while preserving forbidden paths", () => {
    const unrestricted = workerContractFromPolicy("task", "run_unrestricted", {
      scope: { targetFiles: [], targetSubsystems: [], avoidAreas: [] },
      budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
      postconditions: { verificationRequired: false, validationPlan: [], validationCommands: [] },
      sensitivity: { sensitivePatterns: [], forbiddenPatterns: ["package.json"] },
    })
    expect(validateWorkerPatchScope(["src/math.ts"], unrestricted)).toEqual([])
    expect(validateWorkerPatchScope(["package.json"], unrestricted)).toEqual([
      { path: "package.json", kind: "forbidden", patterns: ["package.json"] },
    ])
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
        return { content: "diff --git a/src/x.ts b/src/x.ts\n+added", changedPaths: ["src/x.ts"] }
      },
    })

    const checkout = await WorkerRunEffects.current.createCheckout("/repo", "run_1")
    const result = await WorkerRunEffects.current.runWorker(
      { providerId: "claude", workerId: "claude", command: ["claude", "-p", "x"], env: {}, network: "full", egress: { mode: "unconfined" }, writableStatePaths: [], timeoutMs: 1000 },
      checkout.path,
    )
    const patch = await WorkerRunEffects.current.computeDiff(checkout.path)
    await checkout.cleanup()

    expect(result.exitCode).toBe(0)
    expect(patch.content).toContain("+added")
    expect(patch.changedPaths).toEqual(["src/x.ts"])
    expect(calls).toEqual(["checkout:/repo:run_1", "run:claude:/tmp/fake-checkout", "diff", "cleanup"])

    WorkerRunEffects.reset()
    expect(WorkerRunEffects.current.createCheckout).not.toBeUndefined()
  })
})
