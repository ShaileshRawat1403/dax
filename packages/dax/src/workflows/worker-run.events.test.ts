import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import { randomUUID } from "node:crypto"
import { WorkerRunEffects } from "./worker-run"
import { cleanupHarnessRuns, firstEventByType, runWorkflowAndCaptureEvents } from "./workflow-event-harness"
import { ExecutionContract } from "@/execution/execution-contract"
import type { RuntimePolicy } from "@/execution/execution-contract"
import type { WorkerInvocation } from "@/worker/worker-adapter"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"

const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-events-"))
const workspace = path.join(testHome, "workspace")
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = testHome

let runCounter = 0
function makeRunId(): string {
  runCounter += 1
  return `run_event_harness_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 8)}_${runCounter}`
}

function workerPolicy(
  writeScope: string[],
  forbidden: string[],
  verification: string[] = [],
): RuntimePolicy {
  return {
    scope: { targetFiles: writeScope, targetSubsystems: [], avoidAreas: [] },
    budgets: { maxFilesTouched: 8, maxMutatingCommands: 6, maxApprovalRequests: 4, maxRepeatedFailures: 3 },
    postconditions: { verificationRequired: verification.length > 0, validationPlan: [], validationCommands: verification },
    sensitivity: { sensitivePatterns: [], forbiddenPatterns: forbidden },
    provenance: {
      writeScope: "operator-confirmed",
      forbiddenPaths: "operator-authored",
      verification: "inferred-unreviewed",
    },
  }
}

function makeContract(overrides: Partial<ExecutionContract> = {}): ExecutionContract {
  const runId = overrides.runId ?? makeRunId()
  return ExecutionContract.parse({
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass: "worker_run",
    intent: "add an isEven helper",
    executionMode: "approval_gated",
    riskLevel: "medium",
    toolAllowlist: [],
    toolBlocklist: [],
    approvalPolicy: { mode: "approval_gated", toolCategories: ["edit"] },
    expectedOutputs: [{ type: "patch", description: "a kernel-computed patch" }],
    timeoutMs: 60_000,
    providerHint: "worker:codex",
    repoPath: "/repo/under/governance",
    createdAt: new Date().toISOString(),
    ...overrides,
  })
}

function passedCheck(check: CheckDefinition): CheckResult {
  const now = new Date().toISOString()
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    command: [check.command, ...check.args].join(" "),
    cwd: check.cwd,
    required: check.required,
    risk: check.risk,
    exitCode: 0,
    status: "passed",
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    stdoutPreview: "",
    stderrPreview: "",
  }
}

function successfulEffects(invocations: WorkerInvocation[]) {
  return {
    async createCheckout() {
      return { path: path.join(workspace, "checkout"), cleanup: async () => {} }
    },
    async runWorker(invocation: WorkerInvocation) {
      invocations.push(invocation)
      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        sandboxProvider: "seatbelt" as const,
        reapedDescendants: false,
      }
    },
    async computeDiff() {
      return {
        content: "diff --git a/src/is-even.ts b/src/is-even.ts\n+export const isEven = (n: number) => n % 2 === 0",
        changedPaths: ["src/is-even.ts"],
      }
    },
    async runVerification(check: CheckDefinition): Promise<CheckResult> {
      return passedCheck(check)
    },
  }
}

beforeAll(() => {
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(workspace, { recursive: true })
})

afterEach(() => {
  WorkerRunEffects.reset()
})

afterAll(async () => {
  await cleanupHarnessRuns()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  rmSync(testHome, { recursive: true, force: true })
})

describe("worker_run evidence contract (event harness)", () => {
  test("records what the operator was asked to permit, not just that they were asked", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set(successfulEffects(invocations))
    const contract = makeContract({
      providerHint: "worker:codex",
      runtimePolicy: workerPolicy(["src/**"], ["package.json"], ["bun test"]),
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract,
      directory: workspace,
    })

    const requested = firstEventByType(run.events, "approval_requested")
    expect(requested).toBeDefined()

    const payload = requested!.payload as {
      approvalId: string
      approvalType: string
      risk: string
      title?: string
      reason?: string
      expectedConsequence?: string
    }

    // A reviewer holding only this log must be able to say what was permitted.
    expect(payload.title).toBeTruthy()
    expect(payload.reason).toBeTruthy()
    expect(payload.expectedConsequence).toBeTruthy()
    expect(payload.approvalType).toBe("patch_apply")
  })

  test("records the mutation it made, from the kernel-computed diff", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set(successfulEffects(invocations))
    const contract = makeContract({
      providerHint: "worker:codex",
      runtimePolicy: workerPolicy(["src/**"], ["package.json"], ["bun test"]),
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract,
      directory: workspace,
    })

    const mutation = firstEventByType(run.events, "mutation_recorded")
    expect(mutation).toBeDefined()

    const payload = mutation!.payload as { receiptIds: string[]; changedPaths: string[] }
    expect(payload.receiptIds.length).toBeGreaterThan(0)
    expect(payload.changedPaths.length).toBeGreaterThan(0)

    // The change is attested before review, so a run cannot reach an operator
    // with its diff unaccounted for.
    const sandboxSeq = firstEventByType(run.events, "worker_sandbox_recorded")?.seq ?? -1
    expect(mutation!.seq).toBeGreaterThan(sandboxSeq)
  })

  test("resolves the provider through the registry and records its identity as evidence", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set(successfulEffects(invocations))
    const contract = makeContract({
      providerHint: "worker:codex",
      runtimePolicy: workerPolicy(["src/**"], ["package.json"], ["bun test"]),
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract,
      directory: workspace,
    })

    const sandbox = firstEventByType(run.events, "worker_sandbox_recorded")
    expect(sandbox).toBeDefined()
    const payload = sandbox!.payload as {
      providerId?: string
      provider: string
      filesystem: string
      network: string
      reapedDescendants: boolean
    }

    expect(invocations).toHaveLength(1)
    expect(invocations[0].providerId).toBe("codex")
    expect(invocations[0].command[0]).toBe("codex")
    expect(payload.providerId).toBe("codex")
    expect(payload.providerId).toBe(invocations[0].providerId)
    expect(payload.provider).toBe("seatbelt")
    expect(payload.filesystem).toBe("checkout-write-only")
    expect(payload.network).toBe("full")
    expect(payload.reapedDescendants).toBe(false)
  })

  test("carries reapedDescendants from containment into the ledger", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runWorker(invocation: WorkerInvocation) {
        invocations.push(invocation)
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          sandboxProvider: "seatbelt" as const,
          reapedDescendants: true,
        }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract(),
      directory: workspace,
    })

    const sandbox = firstEventByType(run.events, "worker_sandbox_recorded")
    expect((sandbox!.payload as { reapedDescendants: boolean }).reapedDescendants).toBe(true)
  })

  test("records containment evidence before failing the run on timeout", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runWorker(invocation: WorkerInvocation) {
        invocations.push(invocation)
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: true,
          sandboxProvider: "seatbelt" as const,
          reapedDescendants: true,
        }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract(),
      directory: workspace,
    })

    expect(run.result.success).toBe(false)
    const sandbox = firstEventByType(run.events, "worker_sandbox_recorded")
    const failed = firstEventByType(run.events, "run_failed")
    expect(sandbox).toBeDefined()
    expect(failed).toBeDefined()
    expect(sandbox!.seq).toBeLessThan(failed!.seq)
    expect((sandbox!.payload as { reapedDescendants: boolean }).reapedDescendants).toBe(true)
    expect(run.state?.status).toBe("failed")
    expect(
      (firstEventByType(run.events, "step_failed")?.payload as { error: { code: string } }).error.code,
    ).toBe("worker_failed")
  })

  test("records containment evidence before failing the run on a non-zero exit", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runWorker(invocation: WorkerInvocation) {
        invocations.push(invocation)
        return {
          exitCode: 2,
          stdout: "",
          stderr: "boom",
          sandboxProvider: "seatbelt" as const,
          reapedDescendants: false,
        }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract(),
      directory: workspace,
    })

    expect(run.result.success).toBe(false)
    const sandbox = firstEventByType(run.events, "worker_sandbox_recorded")
    const failed = firstEventByType(run.events, "run_failed")
    expect(sandbox!.seq).toBeLessThan(failed!.seq)
    expect((failed!.payload as { error: { message: string } }).error.message).toContain("exited 2")
    expect(run.state?.status).toBe("failed")
  })

  test("an Antigravity non-success terminal status cannot become a reviewed mutation", async () => {
    const invocations: WorkerInvocation[] = []
    let diffObserved = false
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runWorker(invocation: WorkerInvocation) {
        invocations.push(invocation)
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            conversation_id: "",
            status: "CANCELED",
            response: "",
            error: "write permission denied",
            duration_seconds: 0.2,
            num_turns: 1,
            usage: {
              input_tokens: 10,
              output_tokens: 0,
              thinking_tokens: 0,
              cache_read_tokens: 0,
              total_tokens: 10,
            },
          }),
          stderr: "",
          sandboxProvider: "seatbelt" as const,
          reapedDescendants: false,
        }
      },
      async computeDiff() {
        diffObserved = true
        return { content: "diff that must not be admitted", changedPaths: ["src/unsafe.ts"] }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract({ providerHint: "worker:antigravity" }),
      directory: workspace,
    })

    expect(run.result.success).toBe(false)
    expect(invocations[0]?.command[0]).toBe("agy")
    expect(diffObserved).toBe(false)
    expect(firstEventByType(run.events, "mutation_recorded")).toBeUndefined()
    expect(firstEventByType(run.events, "approval_requested")).toBeUndefined()
    expect((firstEventByType(run.events, "run_failed")?.payload as { error: { message: string } }).error.message).toContain(
      "Antigravity CLI ended with CANCELED",
    )
  })

  test("emits scope provenance and verification receipts on the success path", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set(successfulEffects(invocations))
    const contract = makeContract({
      providerHint: "worker:claude",
      runtimePolicy: workerPolicy(["src/**"], ["package.json"], ["bun test"]),
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract,
      directory: workspace,
    })

    expect(run.result.success).toBe(true)

    const refined = firstEventByType(run.events, "contract_refined")
    const refinedPayload = refined!.payload as {
      writeScope: string[]
      forbiddenPaths: string[]
      verification: string[]
      provenance: { writeScope: string; forbiddenPaths: string; verification: string }
    }
    expect(refinedPayload.writeScope).toEqual(["src/**"])
    expect(refinedPayload.forbiddenPaths).toEqual(["package.json"])
    expect(refinedPayload.verification).toEqual(["bun test"])
    expect(refinedPayload.provenance).toEqual({
      writeScope: "operator-confirmed",
      forbiddenPaths: "operator-authored",
      verification: "inferred-unreviewed",
    })

    const verification = firstEventByType(run.events, "verification_recorded")
    const verificationPayload = verification!.payload as {
      status: string
      receipts: Array<{ receiptId: string }>
    }
    expect(verificationPayload.status).toBe("passed")
    expect(verificationPayload.receipts.length).toBeGreaterThan(0)
    expect(verificationPayload.receipts[0].receiptId).toBeTruthy()

    const artifact = firstEventByType(run.events, "artifact_created")
    expect((artifact!.payload as { artifactType: string }).artifactType).toBe("verification_report")
    expect(firstEventByType(run.events, "draft_created")).toBeDefined()
    expect(firstEventByType(run.events, "approval_requested")).toBeDefined()
    expect(run.state?.status).toBe("waiting_approval")
  })

  test("fails closed with invalid_worker on an unregistered provider hint", async () => {
    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract({ providerHint: "worker:copilot" }),
      directory: workspace,
    })

    expect(run.result.success).toBe(false)
    const failed = firstEventByType(run.events, "run_failed")
    expect((failed!.payload as { error: { code: string } }).error.code).toBe("invalid_worker")
    expect(run.state?.status).toBe("failed")
  })

  test("a failed verification blocks review and records the failed status", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runVerification(check: CheckDefinition): Promise<CheckResult> {
        const now = new Date().toISOString()
        return {
          ...passedCheck(check),
          exitCode: 1,
          status: "failed",
          stderrPreview: "boom",
          startedAt: now,
          finishedAt: now,
        }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract({
        runtimePolicy: workerPolicy(["src/**"], ["package.json"], ["bun test"]),
      }),
      directory: workspace,
    })

    expect(run.result.success).toBe(false)
    const verification = firstEventByType(run.events, "verification_recorded")
    expect((verification!.payload as { status: string }).status).toBe("failed")
    const failed = firstEventByType(run.events, "run_failed")
    expect((failed!.payload as { error: { code: string } }).error.code).toBe("verification_failed")
    expect(run.state?.status).toBe("failed")
  })

  test("emits no sandbox evidence when the sandbox provider is absent", async () => {
    const invocations: WorkerInvocation[] = []
    WorkerRunEffects.set({
      ...successfulEffects(invocations),
      async runWorker(invocation: WorkerInvocation) {
        invocations.push(invocation)
        return { exitCode: 0, stdout: "ok", stderr: "", reapedDescendants: false }
      },
    })

    const run = await runWorkflowAndCaptureEvents({
      workflowClass: "worker_run",
      contract: makeContract({
        runtimePolicy: workerPolicy(["src/**"], [], ["bun test"]),
      }),
      directory: workspace,
    })

    expect(run.events.some((event) => event.type === "worker_sandbox_recorded")).toBe(false)
    expect(run.result.success).toBe(true)
  })
})
