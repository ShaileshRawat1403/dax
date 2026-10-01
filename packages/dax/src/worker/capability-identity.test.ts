import { readRunEvents } from "@/state/events/run-event-store"
import { ContractGuardian } from "@/execution/contract-guardian"
import { Instance } from "@/project/instance"
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { ExecutionContract } from "@/execution/execution-contract"
import { WorkerRunEffects } from "@/workflows/worker-run"
import { cleanupHarnessRuns, eventByType, runWorkflowAndCaptureEvents } from "@/workflows/workflow-event-harness"
import {
  DefaultWorkerProviderRegistry,
  WORKER_PROFILES,
  WorkerProviderRegistry,
  buildProviderInvocation,
  listBuiltinWorkerCapabilities,
  requireBuiltinWorkerInvocationCapability,
  requireBuiltinWorkerProfileCapability,
  type WorkerInvocation,
} from "./worker-adapter"

const home = mkdtempSync(path.join(os.tmpdir(), "dax-worker-identity-"))
const workspace = path.join(home, "workspace")
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = home
mkdirSync(workspace, { recursive: true })

function workerContract() {
  const runId = `run_worker_identity_${randomUUID().replaceAll("-", "")}`
  return ExecutionContract.parse({
    schemaVersion: "v1",
    contractId: `ctr_${runId}`,
    runId,
    workflowClass: "worker_run",
    intent: "Prove worker adapter identity",
    executionMode: "approval_gated",
    riskLevel: "medium",
    toolAllowlist: [],
    toolBlocklist: [],
    approvalPolicy: { mode: "approval_gated" },
    expectedOutputs: [{ type: "patch", description: "Candidate patch" }],
    providerHint: "worker:codex",
    repoPath: workspace,
    createdAt: new Date().toISOString(),
  })
}

function invocation(providerId = "codex", registry?: WorkerProviderRegistry) {
  return buildProviderInvocation({
    providerId,
    contract: {
      task: "Identify adapter",
      runId: `run_${randomUUID()}`,
      writeScope: [],
      forbiddenPaths: [],
      verification: [],
    },
    workingDirectory: workspace,
    registry,
  })
}

afterEach(() => WorkerRunEffects.reset())
afterAll(async () => {
  await cleanupHarnessRuns()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe("built-in worker profile identity", () => {
  test("four conservative descriptors carry no execution grants", () => {
    const descriptors = listBuiltinWorkerCapabilities()
    expect(descriptors.map((item) => item.id).sort()).toEqual([
      "worker.profile.antigravity",
      "worker.profile.claude",
      "worker.profile.codex",
      "worker.profile.gemini",
    ])
    for (const item of descriptors) {
      expect(CapabilityDescriptor.safeParse(item).success).toBe(true)
      expect(item.scopeSupport).toBe("opaque")
      expect(item.requiresVerification).toBe(true)
      expect("grant" in item).toBe(false)
    }
  })

  test("default adapter binds the actual invocation, not a custom registry alias", () => {
    const built = invocation()
    expect(requireBuiltinWorkerProfileCapability("codex").id).toBe("worker.profile.codex")
    expect(requireBuiltinWorkerInvocationCapability(built).id).toBe("worker.profile.codex")

    const custom = new WorkerProviderRegistry()
    const realProvider = DefaultWorkerProviderRegistry.get("codex")!
    custom.register(realProvider)
    const customBuilt = invocation("codex", custom)
    expect(() => requireBuiltinWorkerInvocationCapability(customBuilt)).toThrow(CapabilityIdentityError)
    const copy: WorkerInvocation = { ...built, command: [...built.command], env: { ...built.env } }
    expect(() => requireBuiltinWorkerInvocationCapability(copy)).toThrow(CapabilityIdentityError)
  })

  test("execution-relevant invocation changes invalidate a built binding", () => {
    const built = invocation()
    built.command.push("--unexpected")
    expect(() => requireBuiltinWorkerInvocationCapability(built)).toThrow(CapabilityIdentityError)
    const changedEnv = invocation()
    changedEnv.env.EXTRA = "unexpected"
    expect(() => requireBuiltinWorkerInvocationCapability(changedEnv)).toThrow(CapabilityIdentityError)
    const changedProvider = invocation()
    changedProvider.providerId = "claude"
    expect(() => requireBuiltinWorkerInvocationCapability(changedProvider)).toThrow(CapabilityIdentityError)
  })

  test("a worker launch records the profile that runs, record only, before launch", async () => {
    const governing = workerContract()
    await Instance.provide({ directory: workspace, fn: () => ContractGuardian.create(governing.runId, governing) })
    let launchedAfterRecord = false
    WorkerRunEffects.set({
      async createCheckout() {
        return { path: workspace, cleanup: async () => {} }
      },
      async runWorker() {
        const events = await Instance.provide({ directory: workspace, fn: () => readRunEvents(governing.runId) })
        launchedAfterRecord = events.some((event) => event.type === "capability_resolution_recorded")
        throw new Error("controlled worker stop")
      },
    })
    const run = await runWorkflowAndCaptureEvents({ workflowClass: "worker_run", contract: governing, directory: workspace })
    expect(run.result.success).toBe(false)
    expect(launchedAfterRecord).toBe(true)
    expect(
      eventByType(run.events, "capability_resolution_recorded").map((event) => event.payload),
    ).toMatchObject([
      { path: "workflow", capabilityId: "workflow.worker_run.execute", initiator: "system" },
      {
        enforcement: "record_only",
        path: "worker",
        initiator: "system",
        capabilityId: "worker.profile.codex",
        enrolled: true,
        basis: "v1_contract",
        decision: "allow",
        reasonCode: "v1_contract_has_no_selector",
      },
    ])
  })

  test("changed built-in profile fails before checkout and worker launch", async () => {
    const original = WORKER_PROFILES.codex.binary
    let checkouts = 0
    let launches = 0
    WorkerRunEffects.set({
      async createCheckout() {
        checkouts++
        return { path: workspace, cleanup: async () => {} }
      },
      async runWorker() {
        launches++
        throw new Error("must not run")
      },
    })
    try {
      WORKER_PROFILES.codex.binary = "changed-binary"
      const run = await runWorkflowAndCaptureEvents({
        workflowClass: "worker_run",
        contract: workerContract(),
        directory: workspace,
      })
      expect(run.result.success).toBe(false)
      expect(checkouts).toBe(0)
      expect(launches).toBe(0)
      expect(eventByType(run.events, "contract_refined")).toHaveLength(0)
      expect(eventByType(run.events, "approval_requested")).toHaveLength(0)
      expect(eventByType(run.events, "run_failed")).toHaveLength(1)
    } finally {
      WORKER_PROFILES.codex.binary = original
    }
  })

  test("profile change during awaited checkout cannot reach the worker", async () => {
    const original = WORKER_PROFILES.codex.binary
    let launches = 0
    let cleanups = 0
    WorkerRunEffects.set({
      async createCheckout() {
        WORKER_PROFILES.codex.binary = "changed-after-checkout"
        return {
          path: workspace,
          cleanup: async () => {
            cleanups++
          },
        }
      },
      async runWorker() {
        launches++
        throw new Error("must not run")
      },
    })
    try {
      const run = await runWorkflowAndCaptureEvents({
        workflowClass: "worker_run",
        contract: workerContract(),
        directory: workspace,
      })
      expect(run.result.success).toBe(false)
      expect(launches).toBe(0)
      expect(cleanups).toBe(1)
      expect(eventByType(run.events, "approval_requested")).toHaveLength(0)
      expect(eventByType(run.events, "run_failed")).toHaveLength(1)
    } finally {
      WORKER_PROFILES.codex.binary = original
    }
  })
})
